import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';

// Date Format Helpers
const getTodayDateString = () => new Date().toLocaleDateString('en-CA'); // yyyy-MM-dd
const getLongDisplayDate = () => new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const formatTimestamp = (isoString) => isoString ? new Date(isoString).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

// Custom Icons
const Icon = ({ name, className = "" }) => <i className={`fas fa-${name} ${className}`}></i>;

function App() {
    // Local Storage Helper
    const loadState = (key, defaultValue) => {
        try {
            const saved = localStorage.getItem(key);
            return saved !== null ? JSON.parse(saved) : defaultValue;
        } catch (e) {
            console.error("Local storage error:", e);
            return defaultValue;
        }
    };

    // Data State
    const [employees, setEmployees] = useState(() => loadState('autotrack_employees', []));
    const [attendance, setAttendance] = useState(() => loadState('autotrack_attendance', []));
    const [advances, setAdvances] = useState(() => loadState('autotrack_advances', []));

    // Persist to Local Storage
    useEffect(() => {
        localStorage.setItem('autotrack_employees', JSON.stringify(employees));
    }, [employees]);

    useEffect(() => {
        localStorage.setItem('autotrack_attendance', JSON.stringify(attendance));
    }, [attendance]);

    useEffect(() => {
        localStorage.setItem('autotrack_advances', JSON.stringify(advances));
    }, [advances]);

    // UI State
    const [activeTab, setActiveTab] = useState('dashboard');
    const [exportMonth, setExportMonth] = useState(() => new Date().toISOString().slice(0, 7)); // yyyy-MM
    const [selectedDate, setSelectedDate] = useState(getTodayDateString());
    const [notification, setNotification] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingEmpId, setEditingEmpId] = useState(null);
    const [empForm, setEmpForm] = useState({ name: '', gender: 'Male', rate: '' });

    // Notify Helper
    const notify = (msg, type = 'success') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 3000);
    };

    // Excel Import
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const bstr = evt.target.result;
            const wb = XLSX.read(bstr, { type: 'binary' });

            // Load Employees
            const wsnameEmp = wb.SheetNames.includes('Employees') ? 'Employees' : wb.SheetNames[0];
            const wsEmp = wb.Sheets[wsnameEmp];
            const dataEmp = XLSX.utils.sheet_to_json(wsEmp);

            // Load Attendance
            const rawAtt = wb.SheetNames.includes('Attendance')
                ? XLSX.utils.sheet_to_json(wb.Sheets['Attendance']) : [];
            const dataAtt = rawAtt.map(a => ({
                Date: a['Date'] || a.Date,
                EmployeeID: a['Employee ID'] || a.EmployeeID,
                Status: a['Status'] || a.Status,
                TimeStamp: a['Timestamp'] || a.TimeStamp || null
            }));

            // Load Advances
            const rawAdv = wb.SheetNames.includes('Advances')
                ? XLSX.utils.sheet_to_json(wb.Sheets['Advances']) : [];
            const dataAdv = rawAdv.map(a => ({
                Date: a['Date'] || a.Date,
                EmployeeID: a['Employee ID'] || a.EmployeeID,
                Amount: parseFloat(a['Amount (Rs)'] || a.Amount || 0),
                Reason: a['Reason'] || a.Reason || '',
                TimeStamp: a['Timestamp'] || a.TimeStamp || null
            }));

            // Normalize imported rows — handle both old random-ID exports and new EMP-XXX exports
            const importedEmps = dataEmp.map((e, idx) => {
                // Accept column names from both old and new export formats
                const rawId = e['Employee ID'] || e['ID'] || '';
                const name = e['Full Name'] || e['Name'] || 'Unknown';
                const gender = e['Gender'] || 'Male';
                const rate = parseFloat(e['Per Day Rate (Rs)'] || e['PerDayRate'] || 0);

                // Re-assign a proper sequential ID if it looks like a random string
                const isProper = /^EMP-\d+$/i.test(rawId);
                return { _idx: idx, _rawId: rawId, _isProper: isProper, name, gender, rate };
            });

            // Find highest EMP-XXX number already used
            const maxExisting = importedEmps
                .filter(e => e._isProper)
                .reduce((max, e) => Math.max(max, parseInt(e._rawId.split('-')[1])), 0);

            let counter = maxExisting;
            const normalizedEmps = importedEmps.map(e => {
                let id = e._rawId;
                if (!e._isProper) {
                    counter++;
                    id = `EMP-${counter.toString().padStart(3, '0')}`;
                }
                return { id, name: e.name, gender: e.gender, rate: e.rate };
            });

            setEmployees(normalizedEmps);

            setAttendance(dataAtt);
            setAdvances(dataAdv);
            notify("Database loaded successfully!");
        };
        reader.readAsBinaryString(file);
    };

    // Excel Export
    const handleExport = () => {
        const wb = XLSX.utils.book_new();

        // Helper: auto column widths
        const setColWidths = (ws, widths) => {
            ws['!cols'] = widths.map(w => ({ wch: w }));
        };

        // Helper: build sheet with EXPLICIT column order
        const makeSheet = (headers, rows, fallback) => {
            const data = rows.length ? rows : [fallback];
            const ws = XLSX.utils.aoa_to_sheet([headers, ...data.map(row => headers.map(h => row[h] ?? ''))]);
            return ws;
        };

        // Filter by selected month (exportMonth = 'yyyy-MM')
        const inMonth = (dateStr) => exportMonth ? dateStr?.startsWith(exportMonth) : true;

        // ── Sheet 1: Employees (all, not filtered by month) ──
        const empHeaders = ['Employee ID', 'Full Name', 'Gender', 'Per Day Rate (Rs)', 'Days Present', 'Total Advance (Rs)', 'Net Salary (Rs)'];
        const empRows = employees.map(e => {
            const empAdvAll = advances.filter(a => a.EmployeeID === e.id);
            const totalAdvAll = empAdvAll.reduce((sum, a) => sum + parseFloat(a.Amount || 0), 0);
            const presentDaysAll = attendance.filter(a => a.EmployeeID === e.id && a.Status === 'Present').length;
            const grossAll = presentDaysAll * e.rate;
            const netAll = grossAll - totalAdvAll;
            return {
                'Employee ID': e.id,
                'Full Name': e.name,
                'Gender': e.gender,
                'Per Day Rate (Rs)': e.rate,
                'Days Present': presentDaysAll,
                'Total Advance (Rs)': totalAdvAll,
                'Net Salary (Rs)': netAll
            };
        });
        const wsEmp = makeSheet(empHeaders, empRows, { 'Employee ID': '', 'Full Name': '', 'Gender': '', 'Per Day Rate (Rs)': '', 'Days Present': '', 'Total Advance (Rs)': '', 'Net Salary (Rs)': '' });
        setColWidths(wsEmp, [14, 24, 10, 18, 14, 20, 18]);
        XLSX.utils.book_append_sheet(wb, wsEmp, 'Employees');

        // ── Sheet 2: Attendance (filtered by month) ──
        const attHeaders = ['Date', 'Employee ID', 'Employee Name', 'Status', 'Timestamp'];
        const attFiltered = attendance.filter(a => inMonth(a.Date));
        const attRows = attFiltered.map(a => {
            const emp = employees.find(e => e.id === a.EmployeeID);
            return {
                'Date': a.Date,
                'Employee ID': a.EmployeeID,
                'Employee Name': emp ? emp.name : 'Unknown',
                'Status': a.Status,
                'Timestamp': a.TimeStamp ? new Date(a.TimeStamp).toLocaleString('en-IN') : ''
            };
        });
        const wsAtt = makeSheet(attHeaders, attRows, { 'Date': '', 'Employee ID': '', 'Employee Name': '', 'Status': '', 'Timestamp': '' });
        setColWidths(wsAtt, [14, 14, 24, 10, 26]);
        XLSX.utils.book_append_sheet(wb, wsAtt, 'Attendance');

        // ── Sheet 3: Advances (filtered by month) ──
        const advHeaders = ['Date', 'Employee ID', 'Employee Name', 'Amount (Rs)', 'Reason', 'Timestamp'];
        const advFiltered = advances.filter(a => inMonth(a.Date));
        const advRows = advFiltered.map(a => {
            const emp = employees.find(e => e.id === a.EmployeeID);
            return {
                'Date': a.Date,
                'Employee ID': a.EmployeeID,
                'Employee Name': emp ? emp.name : 'Unknown',
                'Amount (Rs)': a.Amount,
                'Reason': a.Reason || '',
                'Timestamp': a.TimeStamp ? new Date(a.TimeStamp).toLocaleString('en-IN') : ''
            };
        });
        const wsAdv = makeSheet(advHeaders, advRows, { 'Date': '', 'Employee ID': '', 'Employee Name': '', 'Amount (Rs)': '', 'Reason': '', 'Timestamp': '' });
        setColWidths(wsAdv, [14, 14, 24, 14, 30, 26]);
        XLSX.utils.book_append_sheet(wb, wsAdv, 'Advances');

        // ── Sheet 4: Salary Report ──
        const salaryHeaders = [
            'Employee ID',
            'Employee Name',
            'Gender',
            'Pay Per Day (Rs)',
            'Present Days',
            'Gross Salary (Rs)',
            'Advance Given (Rs)',
            'Final Salary (Rs)'
        ];
        const salaryRows = employees.map(emp => {
            const empAdv = advFiltered.filter(a => a.EmployeeID === emp.id);
            const advanceGiven = empAdv.reduce((sum, a) => sum + parseFloat(a.Amount || 0), 0);
            const presentDays = attFiltered.filter(a => a.EmployeeID === emp.id && a.Status === 'Present').length;
            const grossSalary = presentDays * emp.rate;
            const finalSalary = grossSalary - advanceGiven;
            return {
                'Employee ID': emp.id,
                'Employee Name': emp.name,
                'Gender': emp.gender,
                'Pay Per Day (Rs)': emp.rate,
                'Present Days': presentDays,
                'Gross Salary (Rs)': grossSalary,
                'Advance Given (Rs)': advanceGiven,
                'Final Salary (Rs)': finalSalary
            };
        });
        const wsSalary = makeSheet(salaryHeaders, salaryRows, {
            'Employee ID': '', 'Employee Name': '', 'Gender': '', 'Pay Per Day (Rs)': '',
            'Present Days': '', 'Gross Salary (Rs)': '', 'Advance Given (Rs)': '', 'Final Salary (Rs)': ''
        });
        setColWidths(wsSalary, [14, 24, 10, 18, 14, 18, 20, 18]);
        XLSX.utils.book_append_sheet(wb, wsSalary, 'Salary Report');

        const label = exportMonth ? exportMonth : 'All';
        XLSX.writeFile(wb, `Attendance_${label}_${getTodayDateString()}.xlsx`);
        notify(`Exported! Month: ${label} — 4 sheets included`);
    };

    // Calculate derived data
    const stats = useMemo(() => {
        const maleCount = employees.filter(e => e.gender === 'Male').length;
        const femaleCount = employees.filter(e => e.gender === 'Female').length;
        return { maleCount, femaleCount, total: employees.length };
    }, [employees]);

    const employeeRecords = useMemo(() => {
        const inMonth = (dateStr) => exportMonth ? dateStr?.startsWith(exportMonth) : true;

        return employees.map(emp => {
            const empAdvances = advances.filter(a => a.EmployeeID === emp.id && inMonth(a.Date));
            const totalAdvances = empAdvances.reduce((sum, a) => sum + parseFloat(a.Amount || 0), 0);

            const empAttendance = attendance.filter(a => a.EmployeeID === emp.id && a.Status === 'Present' && inMonth(a.Date));
            const presentDays = empAttendance.length;

            const grossSalary = presentDays * emp.rate;
            const netSalary = grossSalary - totalAdvances;

            return { ...emp, presentDays, totalAdvances, grossSalary, netSalary };
        });
    }, [employees, attendance, advances, exportMonth]);

    // Handlers
    const toggleAttendance = (empId, isPresent) => {
        const timestamp = new Date().toISOString();
        const newAtt = attendance.filter(a => !(a.EmployeeID === empId && a.Date === selectedDate));

        newAtt.push({
            Date: selectedDate,
            TimeStamp: timestamp,
            EmployeeID: empId,
            Status: isPresent ? 'Present' : 'Absent'
        });

        setAttendance(newAtt);
    };

    const handleEmpFormChange = (e) => {
        setEmpForm({ ...empForm, [e.target.name]: e.target.value });
    };

    const addOrUpdateEmployee = (e) => {
        e.preventDefault();

        if (editingEmpId) {
            setEmployees(employees.map(emp =>
                emp.id === editingEmpId
                    ? { ...emp, name: empForm.name, gender: empForm.gender, rate: parseFloat(empForm.rate) }
                    : emp
            ));
            notify("Employee updated successfully");
        } else {
            // Generate proper ID
            const highestNum = employees.reduce((max, emp) => {
                const match = emp.id.match(/^EMP-(\d+)$/);
                return match ? Math.max(max, parseInt(match[1])) : max;
            }, 0);
            const newId = `EMP-${(highestNum + 1).toString().padStart(3, '0')}`;

            const newEmp = {
                id: newId,
                name: empForm.name,
                gender: empForm.gender,
                rate: parseFloat(empForm.rate)
            };
            setEmployees([...employees, newEmp]);
            notify("Employee added successfully");
        }
        setEmpForm({ name: '', gender: 'Male', rate: '' });
        setEditingEmpId(null);
    };

    const editEmployee = (emp) => {
        setEditingEmpId(emp.id);
        setEmpForm({ name: emp.name, gender: emp.gender, rate: emp.rate.toString() });
        notify(`Editing ${emp.name}`, "success");
    };

    const deleteEmployee = (id) => {
        if (window.confirm("Are you sure you want to delete this employee?")) {
            setEmployees(employees.filter(e => e.id !== id));
            notify("Employee deleted successfully", "success");
        }
    };

    const addAdvance = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const newAdv = {
            Date: formData.get('date'),
            TimeStamp: new Date().toISOString(),
            EmployeeID: formData.get('empId'),
            Amount: parseFloat(formData.get('amount')),
            Reason: formData.get('reason')
        };
        setAdvances([...advances, newAdv]);
        e.target.reset();
        notify("Advance recorded successfully");
    };

    return (
        <div className="flex h-screen w-full overflow-hidden font-sans bg-slate-50 text-slate-900">
            {/* Sidebar */}
            <div className="w-64 bg-secondary text-white flex flex-col">
                <div className="p-6">
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <Icon name="bolt" className="text-yellow-400" /> DKA/DKMU
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">Excel-based System</p>
                </div>
                <nav className="flex-1 px-4 space-y-2 mt-4">
                    {['dashboard', 'attendance', 'advances', 'reports'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center gap-3 capitalize ${activeTab === tab ? 'bg-primary text-white' : 'text-slate-300 hover:bg-slate-800'}`}
                        >
                            <Icon name={tab === 'dashboard' ? 'chart-bar' : tab === 'attendance' ? 'calendar-check' : tab === 'advances' ? 'money-bill-wave' : 'users'} />
                            {tab}
                        </button>
                    ))}
                </nav>
                <div className="p-4 border-t border-slate-700">
                    <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 w-full text-center py-2 rounded-lg block text-sm mb-2 transition-colors">
                        <Icon name="file-import" className="mr-2" /> Import Excel
                        <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                    </label>
                    <div className="mb-2">
                        <label className="block text-xs text-slate-400 mb-1"><Icon name="calendar" className="mr-1" /> Export Month</label>
                        <input
                            type="month"
                            value={exportMonth}
                            onChange={e => setExportMonth(e.target.value)}
                            className="w-full px-2 py-1 rounded-lg text-sm bg-slate-800 border border-slate-600 text-slate-200 outline-none focus:border-green-400"
                        />
                    </div>
                    <button onClick={handleExport} className="w-full bg-green-600 hover:bg-green-700 py-2 rounded-lg text-sm transition-colors">
                        <Icon name="file-export" className="mr-2" /> Export Excel
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                {notification && (
                    <div className={`absolute top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium flex items-center gap-2 ${notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>
                        <Icon name={notification.type === 'success' ? 'check-circle' : 'exclamation-circle'} />
                        {notification.msg}
                    </div>
                )}

                <header className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center z-10 w-full">
                    <h2 className="text-2xl font-semibold text-slate-800 capitalize">{activeTab}</h2>
                    <div className="flex items-center gap-6">
                        {/* Global Search Bar */}
                        {['attendance', 'advances', 'reports'].includes(activeTab) && (
                            <div className="relative">
                                <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search employees..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 pr-4 py-2 w-64 border border-slate-200 rounded-full text-sm outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all bg-slate-50 focus:bg-white text-slate-700"
                                />
                                {searchTerm && (
                                    <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        <Icon name="times-circle" />
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="text-sm font-medium text-slate-500 bg-slate-100 px-4 py-2 rounded-full border border-slate-200 whitespace-nowrap">
                            <Icon name="clock" className="mr-2" />
                            {getLongDisplayDate()}
                        </div>
                    </div>
                </header>

                <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-50 p-8">
                    {/* DASHBOARD */}
                    {activeTab === 'dashboard' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-slate-500">Total Employees</p>
                                        <p className="text-3xl font-bold text-slate-800 mt-2">{stats.total}</p>
                                    </div>
                                    <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xl">
                                        <Icon name="users" />
                                    </div>
                                </div>
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
                                    <p className="text-sm font-medium text-slate-500 mb-2">Gender Demographics</p>
                                    <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-2 text-indigo-600 font-semibold"><Icon name="mars" /> {stats.maleCount}</div>
                                        <div className="w-px h-6 bg-slate-200"></div>
                                        <div className="flex items-center gap-2 text-pink-500 font-semibold"><Icon name="venus" /> {stats.femaleCount}</div>
                                    </div>
                                </div>
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-slate-500">Total Advances Given</p>
                                        <p className="text-3xl font-bold text-slate-800 mt-2">
                                            ₹{advances.reduce((s, a) => s + parseFloat(a.Amount || 0), 0)}
                                        </p>
                                    </div>
                                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-xl">
                                        <Icon name="wallet" />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-8">
                                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                                    <h3 className="font-semibold text-slate-800">{editingEmpId ? "Edit Employee" : "Add New Employee"}</h3>
                                    {editingEmpId && (
                                        <button onClick={() => { setEditingEmpId(null); setEmpForm({ name: '', gender: 'Male', rate: '' }); }} className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Cancel Edit</button>
                                    )}
                                </div>
                                <form onSubmit={addOrUpdateEmployee} className="p-6 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                                        <input required name="name" value={empForm.name} onChange={handleEmpFormChange} type="text" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none" placeholder="John Doe" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Gender</label>
                                        <select name="gender" value={empForm.gender} onChange={handleEmpFormChange} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary outline-none">
                                            <option value="Male">Male</option>
                                            <option value="Female">Female</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Per Day Rate (₹)</label>
                                        <input required name="rate" value={empForm.rate} onChange={handleEmpFormChange} type="number" min="0" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary outline-none" placeholder="e.g. 500" />
                                    </div>
                                    <button type="submit" className={`${editingEmpId ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-primary hover:bg-indigo-700'} text-white font-medium py-2 px-4 rounded-lg transition-colors h-10`}>
                                        <Icon name={editingEmpId ? "save" : "plus"} className="mr-2" /> {editingEmpId ? "Update Employee" : "Add Employee"}
                                    </button>
                                </form>
                            </div>

                            {/* Employee Management List */}
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-8">
                                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                                    <h3 className="font-semibold text-slate-800">Employee Management</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-600">
                                                <th className="p-4">ID</th>
                                                <th className="p-4">Name</th>
                                                <th className="p-4">Gender</th>
                                                <th className="p-4">Rate/Day</th>
                                                <th className="p-4">Days Present</th>
                                                <th className="p-4">Total Salary</th>
                                                <th className="p-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {employeeRecords.length === 0 ? (
                                                <tr><td colSpan="7" className="p-8 text-center text-slate-500">No employees found.</td></tr>
                                            ) : employeeRecords.map(emp => (
                                                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="p-4 text-sm text-slate-500">{emp.id}</td>
                                                    <td className="p-4 font-medium text-slate-800">{emp.name}</td>
                                                    <td className="p-4 text-slate-600">{emp.gender}</td>
                                                    <td className="p-4 text-slate-600">₹{emp.rate}</td>
                                                    <td className="p-4">
                                                        <span className="inline-flex items-center gap-1 text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded-full text-sm">
                                                            <Icon name="calendar-check" className="text-xs" />
                                                            {emp.presentDays}
                                                        </span>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="flex flex-col">
                                                            <span className={`font-bold text-sm ${emp.netSalary >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                                                ₹{emp.netSalary.toLocaleString('en-IN')}
                                                            </span>
                                                            {emp.totalAdvances > 0 && (
                                                                <span className="text-xs text-slate-400">
                                                                    Gross ₹{emp.grossSalary} − Adv ₹{emp.totalAdvances}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-right space-x-2">
                                                        <button onClick={() => editEmployee(emp)} className="text-blue-500 hover:text-blue-700 transition-colors p-2 rounded-lg hover:bg-blue-50" title="Edit Employee">
                                                            <Icon name="edit" />
                                                        </button>
                                                        <button onClick={() => deleteEmployee(emp.id)} className="text-red-500 hover:text-red-700 transition-colors p-2 rounded-lg hover:bg-red-50" title="Delete Employee">
                                                            <Icon name="trash" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ATTENDANCE TRACKER */}
                    {activeTab === 'attendance' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-4">
                                    <label className="font-medium text-slate-700">Select Date:</label>
                                    <input
                                        type="date"
                                        value={selectedDate}
                                        onChange={(e) => setSelectedDate(e.target.value)}
                                        className="px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                                <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-2 text-sm text-slate-600"><span className="w-3 h-3 rounded-full bg-green-500"></span> Present</div>
                                    <div className="flex items-center gap-2 text-sm text-slate-600"><span className="w-3 h-3 rounded-full bg-red-400"></span> Absent</div>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-600">
                                            <th className="p-4">Employee</th>
                                            <th className="p-4">Gender</th>
                                            <th className="p-4">Status & Action</th>
                                            <th className="p-4">Recorded Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {employees.length === 0 ? (
                                            <tr><td colSpan="4" className="p-8 text-center text-slate-500">No employees added yet.</td></tr>
                                        ) : employees.filter(emp => emp.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                                            <tr><td colSpan="4" className="p-8 text-center text-slate-500">No employees match your search.</td></tr>
                                        ) : employees.filter(emp => emp.name.toLowerCase().includes(searchTerm.toLowerCase())).map(emp => {
                                            const attRecord = attendance.find(a => a.EmployeeID === emp.id && a.Date === selectedDate);
                                            const isPresent = attRecord?.Status === 'Present';
                                            const timestamp = attRecord?.TimeStamp;

                                            return (
                                                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="p-4 font-medium text-slate-800">{emp.name}</td>
                                                    <td className="p-4 text-slate-600">
                                                        {emp.gender === 'Male' ? <span className="text-indigo-600"><Icon name="mars" /> Male</span> : <span className="text-pink-500"><Icon name="venus" /> Female</span>}
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in">
                                                            <input type="checkbox" name="toggle" id={`toggle-${emp.id}`}
                                                                checked={isPresent}
                                                                onChange={(e) => toggleAttendance(emp.id, e.target.checked)}
                                                                className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer"
                                                            />
                                                            <label htmlFor={`toggle-${emp.id}`} className="toggle-label block overflow-hidden h-6 rounded-full bg-gray-300 cursor-pointer"></label>
                                                        </div>
                                                        <span className={`text-sm font-semibold ${isPresent ? 'text-green-600' : 'text-red-500'}`}>
                                                            {isPresent ? 'Present' : 'Absent'}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-sm text-slate-500">
                                                        {timestamp ? formatTimestamp(timestamp) : 'Not Recorded'}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ADVANCES TRACKER */}
                    {activeTab === 'advances' && (
                        <div className="space-y-6">
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
                                    <h3 className="font-semibold text-slate-800">Issue Advance Payment</h3>
                                </div>
                                <form onSubmit={addAdvance} className="p-6 grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                                        <input required name="date" type="date" defaultValue={selectedDate} className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
                                        <select required name="empId" className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none">
                                            <option value="">Select...</option>
                                            {employees.map(e => <option key={e.id} value={e.id}>{e.name} (₹{e.rate}/day)</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Amount (₹)</label>
                                        <input required name="amount" type="number" min="1" className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none" placeholder="e.g. 1000" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Reason/Note</label>
                                        <input name="reason" type="text" className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none" placeholder="e.g. Medical emergency" />
                                    </div>
                                    <button type="submit" className="bg-primary hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors h-10 w-full">
                                        Grant Advance
                                    </button>
                                </form>
                            </div>

                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-600">
                                            <th className="p-4">Advance Date</th>
                                            <th className="p-4">Timestamp Granted</th>
                                            <th className="p-4">Employee</th>
                                            <th className="p-4">Amount</th>
                                            <th className="p-4">Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {advances.length === 0 ? (
                                            <tr><td colSpan="5" className="p-8 text-center text-slate-500">No advances recorded.</td></tr>
                                        ) : advances.filter(adv => {
                                            const emp = employees.find(e => e.id === adv.EmployeeID);
                                            return emp && emp.name.toLowerCase().includes(searchTerm.toLowerCase());
                                        }).length === 0 && searchTerm ? (
                                            <tr><td colSpan="5" className="p-8 text-center text-slate-500">No advances match your search.</td></tr>
                                        ) : advances.filter(adv => {
                                            const emp = employees.find(e => e.id === adv.EmployeeID);
                                            return emp && emp.name.toLowerCase().includes(searchTerm.toLowerCase());
                                        }).slice().reverse().map((adv, idx) => {
                                            const emp = employees.find(e => e.id === adv.EmployeeID);
                                            return (
                                                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                                    <td className="p-4 text-slate-700 font-medium">{adv.Date}</td>
                                                    <td className="p-4 text-sm text-slate-500 drop-shadow-sm">{adv.TimeStamp ? formatTimestamp(adv.TimeStamp) : '-'}</td>
                                                    <td className="p-4 text-slate-800 font-semibold">{emp ? emp.name : 'Unknown'}</td>
                                                    <td className="p-4 text-red-600 font-bold">-₹{adv.Amount}</td>
                                                    <td className="p-4 text-slate-500 italic">{adv.Reason || '-'}</td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* REPORTS & SALARY */}
                    {activeTab === 'reports' && (
                        <div className="space-y-6">
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                                    <h3 className="font-semibold text-slate-800">Salary Calculation Report</h3>
                                    <span className="text-xs text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                                        Calculated based on existing data
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200 text-sm font-semibold text-slate-600">
                                                <th className="p-4">Employee</th>
                                                <th className="p-4">Present Days</th>
                                                <th className="p-4">Rate/Day</th>
                                                <th className="p-4">Gross Salary</th>
                                                <th className="p-4">Total Advances</th>
                                                <th className="p-4">Net Payable</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {employeeRecords.length === 0 ? (
                                                <tr><td colSpan="6" className="p-8 text-center text-slate-500">No data available.</td></tr>
                                            ) : employeeRecords.filter(emp => emp.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 ? (
                                                <tr><td colSpan="6" className="p-8 text-center text-slate-500">No data match your search.</td></tr>
                                            ) : employeeRecords.filter(emp => emp.name.toLowerCase().includes(searchTerm.toLowerCase())).map(emp => (
                                                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="p-4 font-semibold text-slate-800">{emp.name}</td>
                                                    <td className="p-4 text-blue-600 font-bold">{emp.presentDays} <span className="text-xs font-normal text-slate-400">days</span></td>
                                                    <td className="p-4 text-slate-600">₹{emp.rate}</td>
                                                    <td className="p-4 text-emerald-600 font-medium">₹{emp.grossSalary}</td>
                                                    <td className="p-4 text-red-500">₹{emp.totalAdvances}</td>
                                                    <td className="p-4 text-slate-900 font-bold bg-slate-50 border-l border-slate-100">
                                                        ₹{emp.netSalary}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

export default App;

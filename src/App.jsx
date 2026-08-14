import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const SOCKET_URL = 'https://call-log-qaq7.onrender.com';
const API_BASE = 'https://call-log-qaq7.onrender.com';

function App() {
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [socket, setSocket] = useState(null);
  
  // Shared States
  const [logs, setLogs] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [dateFilter, setDateFilter] = useState('Today'); // Today, Yesterday, Last 7 Days, All, Select Date
  const [selectedDate, setSelectedDate] = useState(''); // Specific single date picker
  const [statusFilter, setStatusFilter] = useState('All'); // Stat-card logs filter
  const [searchQuery, setSearchQuery] = useState('');

  // Executive-specific States
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [manualPhone, setManualPhone] = useState('');
  const [activeCall, setActiveCall] = useState(null); // { phoneNumber, name, status, duration }
  const [callNotes, setCallNotes] = useState('');
  const [callOutcome, setCallOutcome] = useState('Interested');
  const [enquiryReceived, setEnquiryReceived] = useState('No');
  const [callTimer, setCallTimer] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contactName, setContactName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [callFormat, setCallFormat] = useState('Select Format');

  // Admin/Manager States
  const [teamMembers, setTeamMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState('All');
  const [liveCalls, setLiveCalls] = useState({}); // empId -> { phoneNumber, status, timestamp }
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [syncStatus, setSyncStatus] = useState('');

  const timerRef = useRef(null);

  // Read saved user session from localStorage on startup
  useEffect(() => {
    const savedUser = localStorage.getItem('crm_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // Establish WebSocket connection when user logs in
  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to socket server');
      newSocket.emit('register', { empId: user.empId, type: 'web' });
    });

    newSocket.on('call-state-update', (data) => {
      console.log('Call state update:', data);
      setActiveCall(prev => {
        if (!prev) return { phoneNumber: data.phoneNumber, name: 'Lead', status: data.status, duration: 0 };
        return { ...prev, status: data.status };
      });

      if (data.status === 'Active') {
        startTimer();
      } else if (data.status === 'Completed' || data.status === 'Disconnected') {
        stopTimer();
      }
    });

    newSocket.on('call-state-error', (data) => {
      alert(data.message);
      setActiveCall(null);
      stopTimer();
    });

    newSocket.on('global-call-activity', (data) => {
      setLiveCalls(prev => {
        const updated = { ...prev };
        if (data.status === 'Completed' || data.status === 'Disconnected') {
          delete updated[data.empId];
        } else {
          updated[data.empId] = {
            phoneNumber: data.phoneNumber,
            status: data.status,
            timestamp: data.timestamp
          };
        }
        return updated;
      });
      if (data.status === 'Completed') {
        fetchLogs();
      }
    });

    newSocket.on('user-status-changed', (data) => {
      setOnlineUsers(prev => {
        const updated = new Set(prev);
        if (data.online) {
          updated.add(data.empId);
        } else {
          updated.delete(data.empId);
        }
        return updated;
      });
    });

    return () => {
      newSocket.disconnect();
    };
  }, [user]);

  // Load configuration and data
  useEffect(() => {
    if (!user) return;
    fetchCategories();
    if (user.role === 'Executive') {
      fetchLeads();
    } else {
      fetchTeamOverview();
    }
  }, [user]);

  // Refetch logs when filters change
  useEffect(() => {
    if (!user) return;
    fetchLogs();
  }, [user, dateFilter, selectedDate, selectedMember]);

  const startTimer = () => {
    stopTimer();
    setCallTimer(0);
    timerRef.current = setInterval(() => {
      setCallTimer(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const fetchLeads = async () => {
    try {
      const res = await fetch(`${API_BASE}/contacts/assigned/${user.empId}`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data);
      }
    } catch (e) {
      console.error('Error fetching leads:', e);
    }
  };

  const fetchTeamOverview = async () => {
    try {
      const res = await fetch(`${API_BASE}/getMembers/${user.empId}`);
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data);
      }
    } catch (e) {
      console.error('Error fetching team:', e);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
      }
    } catch (e) {
      console.error('Error fetching categories:', e);
    }
  };

  // Helper to compute timestamps from date filter presets
  const getDateRangeParams = () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    switch (dateFilter) {
      case 'Today':
        return { startDate: start.getTime(), endDate: end.getTime() };
      case 'Yesterday':
        const yesterdayStart = new Date(start);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        const yesterdayEnd = new Date(end);
        yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
        return { startDate: yesterdayStart.getTime(), endDate: yesterdayEnd.getTime() };
      case 'Last 7 Days':
        const sevenDaysAgo = new Date(start);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return { startDate: sevenDaysAgo.getTime(), endDate: end.getTime() };
      case 'Select Date':
        if (selectedDate) {
          const dateStart = new Date(selectedDate);
          dateStart.setHours(0, 0, 0, 0);
          const dateEnd = new Date(selectedDate);
          dateEnd.setHours(23, 59, 59, 999);
          return { startDate: dateStart.getTime(), endDate: dateEnd.getTime() };
        }
        return { startDate: null, endDate: null };
      case 'All':
      default:
        return { startDate: null, endDate: null };
    }
  };

  const fetchLogs = async () => {
    if (!user) return;
    try {
      const { startDate, endDate } = getDateRangeParams();
      const targetEmpIds = user.role === 'Executive' 
        ? [user.empId] 
        : (selectedMember === 'All' ? [user.empId] : [selectedMember]);
      
      const includeSubs = user.role !== 'Executive' && selectedMember === 'All';

      const res = await fetch(`${API_BASE}/getFilteredLogs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmpIds, startDate, endDate, includeSubordinates: includeSubs })
      });
      
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (e) {
      console.error('Error fetching logs:', e);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const loggedUser = {
          name: data.userName,
          role: data.role,
          empId: data.empId,
          category: data.category
        };
        setUser(loggedUser);
        localStorage.setItem('crm_user', JSON.stringify(loggedUser));
      } else {
        setError(data.message || 'Login failed');
      }
    } catch (err) {
      setError('Server connection error. Please try again.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('crm_user');
    setUser(null);
    setSelectedLead(null);
    setActiveCall(null);
    setLogs([]);
    stopTimer();
  };

  const clearFilters = () => {
    setSelectedCategory('All');
    setDateFilter('Today');
    setSelectedDate('');
    setStatusFilter('All');
    setSelectedMember('All');
    setSearchQuery('');
  };

  const triggerCall = (number, name = 'Lead') => {
    if (!number || !socket) return;
    
    socket.emit('trigger-call', {
      empId: user.empId,
      phoneNumber: number,
      contactName: name
    });

    setActiveCall({
      phoneNumber: number,
      name: name,
      status: 'Triggered',
      duration: 0
    });
    setCallNotes('');
    setEnquiryReceived('No');
    setCallOutcome('Interested');
    setContactName(name === 'Lead' ? '' : name);
    setCompanyName('');
    setAddress('');
    setEmail('');
    setCallFormat('Select Format');
  };

  const submitCallOutcome = async () => {
    if (!activeCall || isSubmitting) return;

    setIsSubmitting(true);

    const isUnconnected = callOutcome === 'Busy' || callOutcome === 'No Answer' || activeCall.status === 'Triggered' || activeCall.status === 'Dialing' || activeCall.status === 'Ringing';
    const finalDuration = isUnconnected ? 0 : callTimer;

    const callRecord = {
      id: Date.now().toString(),
      number: activeCall.phoneNumber,
      name: contactName || activeCall.name,
      type: 2, // Outgoing
      duration: finalDuration,
      date: Date.now(),
      status: callOutcome,
      syncedBy: user.name,
      syncedByEmpId: user.empId,
      category: user.category,
      description: callNotes,
      enquiryReceived: enquiryReceived,
      contactName: contactName,
      companyName: companyName,
      address: address,
      email: email,
      format: callFormat,
      isSaved: true
    };

    try {
      const res = await fetch(`${API_BASE}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: user.name,
          empId: user.empId,
          logs: [callRecord]
        })
      });

      if (res.ok) {
        setLeads(prev => prev.filter(l => l.number !== activeCall.phoneNumber));
        setSelectedLead(null);
        setActiveCall(null);
        stopTimer();
        alert('Call synced successfully!');
        fetchLeads();
        fetchLogs();
      }
    } catch (e) {
      alert('Failed to sync outcome. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const syncGoogleSheet = async () => {
    setSyncStatus('Syncing...');
    try {
      const res = await fetch(`${API_BASE}/contacts/sync-from-sheet`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        setSyncStatus('Sync complete!');
        if (user.role === 'Executive') {
          fetchLeads();
        }
        fetchLogs();
      } else {
        setSyncStatus('Sync failed: ' + data.message);
      }
    } catch (e) {
      setSyncStatus('Sync error');
    }
    setTimeout(() => setSyncStatus(''), 4000);
  };

  const formatDuration = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // CLIENT SIDE FILTERING LOGS
  const filteredLogs = logs.filter(log => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch = query === '' || 
      log.number.includes(query) ||
      (log.name && log.name.toLowerCase().includes(query)) ||
      (log.syncedBy && log.syncedBy.toLowerCase().includes(query)) ||
      (log.description && log.description.toLowerCase().includes(query)) ||
      (log.status && log.status.toLowerCase().includes(query));

    const matchesCategory = selectedCategory === 'All' || log.category === selectedCategory;

    let matchesStatus = true;
    if (statusFilter !== 'All') {
      if (statusFilter === 'Enquiry') {
        matchesStatus = log.enquiryReceived && log.enquiryReceived.toLowerCase() === 'yes';
      } else if (statusFilter === 'Missed') {
        matchesStatus = log.type === 3 || log.type === '3' || log.status === 'No Answer' || log.status === 'Busy';
      } else {
        matchesStatus = log.status && log.status.toLowerCase() === statusFilter.toLowerCase();
      }
    }

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // METRICS COMPUTATIONS
  const totalCalls = logs.length;
  const interestedCalls = logs.filter(l => l.status && l.status.toLowerCase() === 'interested').length;
  const followUpCalls = logs.filter(l => l.status && l.status.toLowerCase() === 'follow up').length;
  const prospectCalls = logs.filter(l => l.status && l.status.toLowerCase() === 'prospect').length;
  const enquiryCalls = logs.filter(l => l.enquiryReceived && l.enquiryReceived.toLowerCase() === 'yes').length;
  const missedCalls = logs.filter(l => l.type === 3 || l.type === '3' || l.status === 'No Answer' || l.status === 'Busy').length;

  // Percentage Calculations
  const getPercentage = (count) => {
    if (totalCalls === 0) return '0%';
    return `${Math.round((count / totalCalls) * 100)}%`;
  };

  // HOURLY PERFORMANCE COMPUTATIONS
  const uniqueDaysDialed = new Set(filteredLogs.map(log => new Date(log.date).toDateString()));
  const numDays = Math.max(uniqueDaysDialed.size, 1);
  const PLANNED_PER_HOUR = 30 * numDays;

  const hourSlots = [
    { label: "9:00 AM - 10:00 AM", hour: 9 },
    { label: "10:00 AM - 11:00 AM", hour: 10 },
    { label: "11:00 AM - 12:00 PM", hour: 11 },
    { label: "12:00 PM - 1:00 PM", hour: 12 },
    { label: "1:00 PM - 2:00 PM", hour: 13 },
    { label: "2:00 PM - 3:00 PM", hour: 14 },
    { label: "3:00 PM - 4:00 PM", hour: 15 },
    { label: "4:00 PM - 5:00 PM", hour: 16 },
    { label: "5:00 PM - 6:00 PM", hour: 17 },
    { label: "6:00 PM - 7:00 PM", hour: 18 }
  ];

  const getPerformanceStatus = (pct) => {
    if (pct >= 90) return { label: "Excellent", className: "badge-perf-excellent" };
    if (pct >= 80) return { label: "Better", className: "badge-perf-better" };
    if (pct >= 70) return { label: "Good", className: "badge-perf-good" };
    if (pct >= 50) return { label: "Average", className: "badge-perf-average" };
    return { label: "Poor", className: "badge-perf-poor" };
  };

  const hourlyPerformance = hourSlots.map(slot => {
    const actual = filteredLogs.filter(log => {
      const logHour = new Date(log.date).getHours();
      return logHour === slot.hour;
    }).length;

    const achievementPct = Math.round((actual / PLANNED_PER_HOUR) * 100) || 0;
    const perf = getPerformanceStatus(achievementPct);

    return {
      label: slot.label,
      planned: PLANNED_PER_HOUR,
      actual,
      achievementPct,
      status: perf.label,
      statusClass: perf.className
    };
  });

  const totalPlanned = hourlyPerformance.reduce((acc, row) => acc + row.planned, 0);
  const totalActual = hourlyPerformance.reduce((acc, row) => acc + row.actual, 0);
  const totalAchievementPct = Math.round((totalActual / totalPlanned) * 100) || 0;
  const overallPerf = getPerformanceStatus(totalAchievementPct);

  // Quick Reference Lists
  const interestedList = logs.filter(l => l.status && l.status.toLowerCase() === 'interested').slice(0, 20);
  const followUpList = logs.filter(l => l.status && l.status.toLowerCase() === 'follow up').slice(0, 20);
  const prospectList = logs.filter(l => l.status && l.status.toLowerCase() === 'prospect').slice(0, 20);

  if (!user) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <div className="auth-header">
            <h1 className="auth-logo">JJ CRM</h1>
            <p className="auth-subtitle">Real-Time Phone Call & Lead Integration</p>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label" htmlFor="username">Employee ID</label>
              <input 
                type="text" 
                id="username" 
                className="form-input" 
                placeholder="Enter Emp ID (e.g. admin or numeric ID)"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <input 
                type="password" 
                id="password" 
                className="form-input" 
                placeholder="••••••••"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </div>
            <button type="submit" className="btn-primary">Authenticate</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="dashboard-header">
        <div className="header-logo">
          <span>⚡</span> JJ CRM
        </div>
        <div className="user-profile">
          <div className="user-info">
            <div className="profile-name">{user.name}</div>
            <div className="profile-role">{user.role} Dashboard (ID: {user.empId})</div>
          </div>
          <button onClick={syncGoogleSheet} className="btn-logout" style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'var(--success)', color: 'var(--success)' }}>
            {syncStatus || 'Sync Leads'}
          </button>
          <button onClick={handleLogout} className="btn-logout">Logout</button>
        </div>
      </header>

      {/* FILTER BAR */}
      <div style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)', padding: '15px 20px' }}>
        <div className="filter-bar">
          <div className="filter-group">
            <span className="filter-label" style={{ marginRight: '6px' }}>DATE:</span>
            <div className="date-pill-container">
              {['Today', 'Yesterday', 'Last 7 Days', 'All', 'Select Date'].map(option => (
                <button
                  key={option}
                  className={`date-pill ${dateFilter === option ? 'active' : ''}`}
                  onClick={() => setDateFilter(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {dateFilter === 'Select Date' && (
            <div className="filter-group">
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="filter-input" />
            </div>
          )}

          <div className="filter-group">
            <span className="filter-label">CATEGORY:</span>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="filter-select">
              <option value="All">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {user.role !== 'Executive' && (
            <div className="filter-group">
              <span className="filter-label">EXECUTIVE:</span>
              <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)} className="filter-select">
                <option value="All">All Team</option>
                {teamMembers.map(m => <option key={m.empId} value={m.empId}>{m.name}</option>)}
              </select>
            </div>
          )}

          <div style={{ flex: 1, minWidth: '200px' }}>
            <input 
              type="text" 
              placeholder="Search logs/number/notes/outcome..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="filter-input"
              style={{ width: '100%' }}
            />
          </div>

          <button onClick={clearFilters} className="btn-clear">
            Clear Filters
          </button>
        </div>
      </div>

      {/* DASHBOARD CONTENT CONTAINER */}
      <div className="main-content" style={{ maxWidth: '100%', width: '100%', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* TOP ROW: DIALER SECTION + STATS ROW ALIGNED IN THE SAME LINE SPANNING FULL WIDTH */}
        <div style={{ display: 'flex', gap: '20px', width: '100%', alignItems: 'stretch' }}>
          {/* MANUAL DIALER CARD */}
          <div className="stat-card" style={{ padding: '20px', width: '320px', display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
            <h4 style={{ fontSize: '14px', marginBottom: '12px', fontWeight: 'bold' }}>Make a Call</h4>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                placeholder="Enter phone number..." 
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                style={{ flex: 1, background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)', padding: '8px 12px', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
              />
              <button onClick={() => { if (manualPhone) triggerCall(manualPhone, 'Manual Dial'); }} className="btn-call" style={{ padding: '8px 16px', fontSize: '13px' }}>
                Call
              </button>
            </div>
          </div>

          {/* STATS CARDS ROW (6 CARDS FILLING THE REMAINING WIDTH) */}
          <div className="stats-row" style={{ flex: 1 }}>
            <div className={`stat-card stat-card-total ${statusFilter === 'All' ? 'active-filter' : ''}`} onClick={() => setStatusFilter('All')}>
              <div className="stat-val">{totalCalls}</div>
              <div className="stat-label">Total Calls</div>
            </div>
            <div className={`stat-card stat-card-interested ${statusFilter === 'Interested' ? 'active-filter' : ''}`} onClick={() => setStatusFilter('Interested')}>
              <div className="stat-val">{interestedCalls}</div>
              <div className="stat-label">
                <span style={{ opacity: 0.8, marginRight: '4px' }}>({getPercentage(interestedCalls)})</span> Interested
              </div>
            </div>
            <div className={`stat-card stat-card-followup ${statusFilter === 'Follow Up' ? 'active-filter' : ''}`} onClick={() => setStatusFilter('Follow Up')}>
              <div className="stat-val">{followUpCalls}</div>
              <div className="stat-label">
                <span style={{ opacity: 0.8, marginRight: '4px' }}>({getPercentage(followUpCalls)})</span> Follow Up
              </div>
            </div>
            <div className={`stat-card stat-card-missed ${statusFilter === 'Missed' ? 'active-filter' : ''}`} onClick={() => setStatusFilter('Missed')}>
              <div className="stat-val">{missedCalls}</div>
              <div className="stat-label">
                <span style={{ opacity: 0.8, marginRight: '4px' }}>({getPercentage(missedCalls)})</span> Missed / Busy
              </div>
            </div>
            <div className={`stat-card stat-card-prospect ${statusFilter === 'Prospect' ? 'active-filter' : ''}`} onClick={() => setStatusFilter('Prospect')}>
              <div className="stat-val">{prospectCalls}</div>
              <div className="stat-label">
                <span style={{ opacity: 0.8, marginRight: '4px' }}>({getPercentage(prospectCalls)})</span> Prospect
              </div>
            </div>
            <div className={`stat-card stat-card-enquiry ${statusFilter === 'Enquiry' ? 'active-filter' : ''}`} onClick={() => setStatusFilter('Enquiry')}>
              <div className="stat-val">{enquiryCalls}</div>
              <div className="stat-label">
                <span style={{ opacity: 0.8, marginRight: '4px' }}>({getPercentage(enquiryCalls)})</span> Enquiry Received
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM ROW: 3-COLUMN GRID ALIGNED SIDE-BY-SIDE */}
        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr) 320px', gap: '20px', width: '100%' }}>
          
          {/* COLUMN 1: LEFT SIDE - ASSIGNED LEADS */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="stat-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '1150px' }}>
              <h4 style={{ fontSize: '14px', marginBottom: '12px', fontWeight: 'bold' }}>Assigned Leads ({leads.length})</h4>
              <div className="leads-list" style={{ flex: 1, overflowY: 'auto' }}>
                {leads.map(lead => (
                  <div 
                    key={lead.number} 
                    className={`lead-item ${selectedLead?.number === lead.number ? 'active' : ''}`}
                    onClick={() => setSelectedLead(lead)}
                  >
                    <div className="lead-name">{lead.name || 'Unnamed Lead'}</div>
                    <div className="lead-phone">📞 {lead.number}</div>
                  </div>
                ))}
                {leads.length === 0 && <div className="empty-state" style={{ padding: '20px' }}>No pending leads.</div>}
              </div>
            </div>
          </div>

          {/* COLUMN 2: CENTER - ACTIVE CALL / HISTORY / HOURLY PERFORMANCE TABLE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
            
            {/* ACTIVE CALL HUD */}
            {activeCall && (
              <div className="call-hud">
                <div className="hud-phone-icon">📞</div>
                <div className="hud-name">{activeCall.name}</div>
                <div className="hud-phone">{activeCall.phoneNumber}</div>
                
                <div className="hud-state">
                  <div className="pulse-dot"></div>
                  {activeCall.status}...
                </div>

                {/* SHOW LIVE TIMER & SOUNDWAVE WHILE CALLING */}
                {activeCall.status !== 'Completed' && activeCall.status !== 'Disconnected' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '15px' }}>
                    <div className="sound-wave" style={{ marginBottom: '15px' }}>
                      <div className="sound-bar"></div>
                      <div className="sound-bar"></div>
                      <div className="sound-bar"></div>
                      <div className="sound-bar"></div>
                      <div className="sound-bar"></div>
                    </div>
                    <div style={{ fontSize: '32px', fontWeight: 'bold', fontFamily: 'var(--font-display)', marginBottom: '15px' }}>
                      {formatDuration(callTimer)}
                    </div>
                    <button 
                      onClick={() => { stopTimer(); setActiveCall(prev => ({ ...prev, status: 'Completed' })); }} 
                      className="btn-call" 
                      style={{ background: 'var(--danger)', padding: '10px 20px', fontSize: '13px', borderRadius: '20px' }}
                    >
                      🛑 End Call & Log Outcome
                    </button>
                  </div>
                )}

                {/* ONLY SHOW OUTCOME FORM AFTER CALL DISCONNECTS / ENDS */}
                {(activeCall.status === 'Completed' || activeCall.status === 'Disconnected') && (
                  <div className="outcome-box" style={{ marginTop: '20px' }}>
                    <h4 className="outcome-title">Call Update & Outcome (Duration: {formatDuration(callTimer)})</h4>
                    <div className="outcome-options" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      {['Interested', 'Follow Up', 'Prospect', 'Not Interested', 'Busy', 'No Answer'].map(outcome => (
                        <button 
                          key={outcome} 
                          className={`outcome-btn ${callOutcome === outcome ? 'active' : ''}`}
                          onClick={() => setCallOutcome(outcome)}
                        >
                          {outcome}
                        </button>
                      ))}
                    </div>

                    {/* ADDITIONAL LEAD DETAILS INPUTS */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '15px', marginBottom: '15px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Contact Name</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          value={contactName} 
                          onChange={(e) => setContactName(e.target.value)} 
                          placeholder="Contact Name" 
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Company Name</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          value={companyName} 
                          onChange={(e) => setCompanyName(e.target.value)} 
                          placeholder="Company Name" 
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Address</label>
                        <input 
                          type="text" 
                          className="form-input" 
                          value={address} 
                          onChange={(e) => setAddress(e.target.value)} 
                          placeholder="Address" 
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Email</label>
                        <input 
                          type="email" 
                          className="form-input" 
                          value={email} 
                          onChange={(e) => setEmail(e.target.value)} 
                          placeholder="Email" 
                        />
                      </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: '15px' }}>
                      <label className="form-label">Select Format</label>
                      <select 
                        className="form-input" 
                        value={callFormat} 
                        onChange={(e) => setCallFormat(e.target.value)}
                        style={{ width: '100%', background: 'var(--bg-secondary)', color: 'white', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '6px' }}
                      >
                        <option value="Select Format">Select Format</option>
                        <option value="General Catalogue Sharing (Format 0005)">General Catalogue Sharing (Format 0005)</option>
                        <option value="Collaboration Opportunity (Format 0003)">Collaboration Opportunity (Format 0003)</option>
                        <option value="Revolutionize Your Printing (Format 0002)">Revolutionize Your Printing (Format 0002)</option>
                        <option value="Elevate Your Brand (Format 0004)">Elevate Your Brand (Format 0004)</option>
                      </select>
                    </div>

                    {/* ENQUIRY RECEIVED: SHOW ONLY WHEN STATUS IS INTERESTED */}
                    {callOutcome === 'Interested' && (
                      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '20px 0' }}>
                        <span className="form-label" style={{ margin: 0 }}>Enquiry Received:</span>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                          <input type="radio" name="enquiry" value="Yes" checked={enquiryReceived === 'Yes'} onChange={() => setEnquiryReceived('Yes')} /> Yes
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
                          <input type="radio" name="enquiry" value="No" checked={enquiryReceived === 'No'} onChange={() => setEnquiryReceived('No')} /> No
                        </label>
                      </div>
                    )}

                    <div className="form-group">
                      <textarea 
                        className="form-input" 
                        rows="2" 
                        placeholder="Remarks / Note about the call..."
                        value={callNotes}
                        onChange={(e) => setCallNotes(e.target.value)}
                      ></textarea>
                    </div>
                    <button 
                      onClick={submitCallOutcome} 
                      className="btn-primary" 
                      style={{ background: isSubmitting ? '#4b5563' : 'var(--success)', cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Syncing...' : 'Sync & Update Status'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* HANDSET CALL TRIGGER FOR SELECTED LEAD */}
            {selectedLead && !activeCall && (
              <div className="detail-card">
                <div className="detail-header">
                  <div className="detail-title">
                    <h2>{selectedLead.name || 'Unnamed Lead'}</h2>
                    <div className="detail-phone">{selectedLead.number}</div>
                  </div>
                  <span className="status-badge pending">Pending Call</span>
                </div>
                <div className="call-action-box">
                  <button onClick={() => triggerCall(selectedLead.number, selectedLead.name)} className="btn-call">
                    <span>📞</span> Call via Handset
                  </button>
                </div>
              </div>
            )}

            {/* CALL HISTORY CONTAINER */}
            <div className="history-box">
              <h3 className="history-title">📊 Call History Logs ({filteredLogs.length})</h3>
              <div className="table-wrapper" style={{ maxHeight: '450px' }}>
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      {user.role !== 'Executive' && <th>Executive</th>}
                      <th>Lead Name</th>
                      <th>Phone</th>
                      <th>Company</th>
                      <th>Address</th>
                      <th>Email</th>
                      <th>Format</th>
                      <th>Duration</th>
                      <th>Outcome</th>
                      <th>Enquiry</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map(log => (
                      <tr key={log.id}>
                        <td>{new Date(log.date).toLocaleTimeString()}</td>
                        {user.role !== 'Executive' && <td>{log.syncedBy}</td>}
                        <td>{log.contactName || log.name || '-'}</td>
                        <td>{log.number}</td>
                        <td>{log.companyName || '-'}</td>
                        <td>{log.address || '-'}</td>
                        <td>{log.email || '-'}</td>
                        <td>{log.format && log.format !== 'Select Format' ? log.format : '-'}</td>
                        <td>{formatDuration(log.duration)}</td>
                        <td>
                          <span className={`badge-outcome ${log.status?.toLowerCase().replace(' ', '-') || 'busy'}`}>
                            {log.status || 'No Status'}
                          </span>
                        </td>
                        <td>{log.enquiryReceived || 'No'}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{log.description || '-'}</td>
                      </tr>
                    ))}
                    {filteredLogs.length === 0 && (
                      <tr>
                        <td colSpan={user.role !== 'Executive' ? 12 : 11} className="empty-state">
                          No call history logs found matching current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* HOURLY PERFORMANCE REPORT TABLE (INCREASED HEIGHT TO FULLY RENDER ALL DATA ROWS WITHOUT INTERNAL CLIPPING) */}
            <div className="hourly-report-card">
              <h3 className="hourly-report-header">
                📈 Hourly Performance (Daily Target: 30 | Active Days: {numDays})
              </h3>
              <div className="table-wrapper hourly-table-wrapper" style={{ maxHeight: '750px' }}>
                <table className="logs-table" style={{ minWidth: '700px' }}>
                  <thead>
                    <tr>
                      <th>Time Slot</th>
                      <th>Planned Calls</th>
                      <th>Actual Calls</th>
                      <th>Achievement</th>
                      <th>Performance Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourlyPerformance.map(row => (
                      <tr key={row.label}>
                        <td><strong>{row.label}</strong></td>
                        <td>{row.planned}</td>
                        <td><strong>{row.actual}</strong></td>
                        <td>{row.achievementPct}%</td>
                        <td>
                          <span className={`badge-perf ${row.statusClass}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    
                    {/* TOTAL SUMMARY ROW */}
                    <tr style={{ background: 'rgba(255, 255, 255, 0.05)', borderTop: '2px solid rgba(255, 255, 255, 0.15)' }}>
                      <td><strong>Total Summary</strong></td>
                      <td><strong>{totalPlanned}</strong></td>
                      <td><strong>{totalActual}</strong></td>
                      <td><strong>{totalAchievementPct}%</strong></td>
                      <td>
                        <span className={`badge-perf ${overallPerf.className}`}>
                          {overallPerf.label}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* COLUMN 3: RIGHT SIDE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '1150px' }}>
            
            {/* BOX 1: INTERESTED */}
            <div className="stat-card" style={{ padding: '16px', borderTop: '3px solid var(--success)', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <h4 style={{ fontSize: '13px', color: '#34d399', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase' }}>
                🟢 Interested Calls ({interestedList.length})
              </h4>
              <div className="right-column-list">
                {interestedList.map(item => (
                  <div 
                    key={item.id} 
                    style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', border: '1px solid var(--border-color)', minWidth: '220px' }}
                    onClick={() => { if (user.role === 'Executive') triggerCall(item.number, item.name); }}
                  >
                    <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name || 'Unnamed'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>📞 {item.number}</div>
                  </div>
                ))}
                {interestedList.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>No records.</div>}
              </div>
            </div>

            {/* BOX 2: FOLLOW UP */}
            <div className="stat-card" style={{ padding: '16px', borderTop: '3px solid var(--warning)', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <h4 style={{ fontSize: '13px', color: '#fbbf24', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase' }}>
                🟡 Follow Up Calls ({followUpList.length})
              </h4>
              <div className="right-column-list">
                {followUpList.map(item => (
                  <div 
                    key={item.id} 
                    style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', border: '1px solid var(--border-color)', minWidth: '220px' }}
                    onClick={() => { if (user.role === 'Executive') triggerCall(item.number, item.name); }}
                  >
                    <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name || 'Unnamed'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>📞 {item.number}</div>
                  </div>
                ))}
                {followUpList.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>No records.</div>}
              </div>
            </div>

            {/* BOX 3: PROSPECT */}
            <div className="stat-card" style={{ padding: '16px', borderTop: '3px solid var(--accent-secondary)', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <h4 style={{ fontSize: '13px', color: '#f472b6', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase' }}>
                🌸 Prospect Calls ({prospectList.length})
              </h4>
              <div className="right-column-list">
                {prospectList.map(item => (
                  <div 
                    key={item.id} 
                    style={{ background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', border: '1px solid var(--border-color)', minWidth: '220px' }}
                    onClick={() => { if (user.role === 'Executive') triggerCall(item.number, item.name); }}
                  >
                    <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name || 'Unnamed'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>📞 {item.number}</div>
                  </div>
                ))}
                {prospectList.length === 0 && <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>No records.</div>}
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* FOOTER SECTION */}
      <footer className="dashboard-footer">
        <div className="footer-content">
          <p>© 2026 harsh vardhan jha JJ GROUP MIS TEAM. All rights reserved.</p>
          <p>Address: A-24, Sec-68, Noida, JJ Imprint PVT. LTD</p>
          <p>
            LinkedIn Profile:{' '}
            <a 
              href="https://www.linkedin.com/in/harsh-vardhan-jha-577841242/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="footer-link"
            >
              harsh-vardhan-jha
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;

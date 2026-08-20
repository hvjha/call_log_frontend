import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

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
  const [teamLeads, setTeamLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [manualPhone, setManualPhone] = useState('');
  const [activeCall, setActiveCall] = useState(null); // { phoneNumber, name, status, duration }
  const [callNotes, setCallNotes] = useState('');
  const [callOutcome, setCallOutcome] = useState('Interested');
  const [enquiryReceived, setEnquiryReceived] = useState('No');
  const [callTimer, setCallTimer] = useState(0);
  const [callStartTime, setCallStartTime] = useState(null); // For robust duration tracking
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contactName, setContactName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [callFormat, setCallFormat] = useState('Select Format');

  // Admin/Manager States
  const [teamMembers, setTeamMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState('All');
  const [selectedLeadManager, setSelectedLeadManager] = useState('All');
  const [liveCalls, setLiveCalls] = useState({}); // empId -> { phoneNumber, status, timestamp }
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [syncStatus, setSyncStatus] = useState('');

  // New Management Dashboard & Admin states
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'management'
  const [showCharts, setShowCharts] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    phone: '',
    empId: '',
    password: '',
    role: 'Executive',
    reportsTo: '',
    category: ''
  });

  const [historyLogs, setHistoryLogs] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyNumber, setHistoryNumber] = useState('');

  const fetchContactHistory = async (number) => {
    try {
      const res = await fetch(`${API_BASE}/contacts/history/${number}`);
      if (res.ok) {
        const data = await res.json();
        setHistoryLogs(data);
        setHistoryNumber(number);
        setShowHistoryModal(true);
      }
    } catch (err) {
      console.error('Error fetching contact history:', err);
    }
  };
  
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState({
    numbersText: '',
    assignedTo: ''
  });
  const [transferringLead, setTransferringLead] = useState(null);
  const [transferToEmpId, setTransferToEmpId] = useState('');

  const timerRef = useRef(null);

  // Read saved user session from localStorage on startup
  useEffect(() => {
    const savedUser = localStorage.getItem('crm_user');
    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      setUser(parsed);
      if (parsed.role === 'Admin') {
        setSelectedMember('');
      } else {
        setSelectedMember('All');
      }
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

      if (data.status === 'Active' || data.status === 'Offhook') {
        setCallStartTime(Date.now());
        startTimer();
      } else if (data.status === 'Completed' || data.status === 'Disconnected' || data.status === 'Idle') {
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

  const getDescendants = (empId, users) => {
    let result = [];
    let queue = [String(empId)];
    while (queue.length > 0) {
      const currentId = queue.shift();
      const children = users.filter(u => String(u.reportsTo) === currentId);
      for (const child of children) {
        if (!result.some(r => r.empId === child.empId)) {
          result.push(child);
          queue.push(String(child.empId));
        }
      }
    }
    return result;
  };

  const fetchAllUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/getAllUsers`);
      const data = await res.json();
      if (res.ok) {
        setAllUsers(data);
      }
    } catch (e) {
      console.error('Error fetching all users:', e);
    }
  };

  // Load configuration and data
  useEffect(() => {
    if (!user) return;
    fetchCategories();
    fetchLeads();
    if (user.role !== 'Executive') {
      fetchAllUsers();
      fetchTeamLeads();
    }
  }, [user]);

  // Fetch leads on tab changes
  useEffect(() => {
    if (!user) return;
    if (activeTab === 'dashboard') {
      fetchLeads();
    } else if (activeTab === 'leads') {
      fetchTeamLeads();
    }
  }, [activeTab, user, selectedLeadManager]);

  // Set team members based on hierarchy when allUsers updates
  useEffect(() => {
    if (!user || allUsers.length === 0) return;
    if (user.role === 'Executive') return;
    if (user.role === 'Admin') {
      setTeamMembers(allUsers);
    } else {
      setTeamMembers(getDescendants(user.empId, allUsers));
    }
  }, [allUsers, user]);

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
      const data = await res.json();
      if (res.ok) {
        setLeads(data);
      }
    } catch (e) {
      console.error('Error fetching assigned leads:', e);
    }
  };

  const fetchTeamLeads = async () => {
    try {
      const targetId = (user.role === 'Admin' && selectedLeadManager !== 'All') ? selectedLeadManager : user.empId;
      const res = await fetch(`${API_BASE}/contacts/team/${targetId}`);
      if (res.ok) {
        const data = await res.json();
        setTeamLeads(data);
      }
    } catch (e) {
      console.error('Error fetching team leads:', e);
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
    if (user.role === 'Admin' && !selectedMember) {
      setLogs([]);
      return;
    }
    try {
      const { startDate, endDate } = getDateRangeParams();
      const targetEmpIds = user.role === 'Executive' 
        ? [user.empId] 
        : (selectedMember === 'All' ? [user.empId] : [selectedMember]);
      
      let includeSubs = false;
      if (user.role !== 'Executive') {
        if (selectedMember === 'All') {
          includeSubs = true;
        } else {
          const selectedUser = allUsers.find(u => String(u.empId) === String(selectedMember));
          if (selectedUser && (selectedUser.role === 'Manager' || selectedUser.role === 'TL' || selectedUser.role === 'Admin' || selectedUser.role === 'Team Leader')) {
            includeSubs = true;
          }
        }
      }

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
        if (loggedUser.role === 'Admin') {
          setSelectedMember('');
        } else {
          setSelectedMember('All');
        }
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

  const triggerCall = async (number, name = 'Lead') => {
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
    setCallStartTime(null); // Reset start time until active
    setCallNotes('');
    setEnquiryReceived('No');
    setCallOutcome('Interested');
    setContactName(name === 'Lead' ? '' : name);
    setCompanyName('');
    setAddress('');
    setEmail('');
    setCallFormat('Select Format');

    try {
      const res = await fetch(`${API_BASE}/contacts/details/${number}`);
      if (res.ok) {
        const details = await res.json();
        if (details) {
          setContactName(details.contactName || details.name || '');
          setCompanyName(details.companyName || '');
          setAddress(details.address || '');
          setEmail(details.email || '');
        }
      }
    } catch (err) {
      console.error('Error fetching details:', err);
    }
  };

  const submitCallOutcome = async () => {
    if (!activeCall || isSubmitting) return;

    setIsSubmitting(true);

    const isUnconnected = callOutcome === 'Busy' || callOutcome === 'No Answer' || activeCall.status === 'Triggered' || activeCall.status === 'Dialing' || activeCall.status === 'Ringing';
    
    let finalDuration = 0;
    if (!isUnconnected) {
      if (callStartTime) {
        finalDuration = Math.floor((Date.now() - callStartTime) / 1000);
      } else {
        finalDuration = callTimer;
      }
    }

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

      const data = await res.json();
      if (res.ok && data.saved && data.sheetsSynced) {
        setLeads(prev => prev.filter(l => l.number !== activeCall.phoneNumber));
        setSelectedLead(null);
        setActiveCall(null);
        stopTimer();
        alert('Call synced successfully!');
        fetchLeads();
        fetchLogs();
      } else if (res.ok && data.saved) {
        alert('Saved in the app, but Google Sheets sync failed. Please retry.');
      } else {
        alert('Failed to save outcome. Please try again.');
      }
    } catch (e) {
      alert('Failed to sync outcome. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCallOutcomeClick = (outcome) => {
    setCallOutcome(outcome);
    if (outcome === 'Busy' || outcome === 'Not Answering') {
      autoSubmitUnconnected(outcome);
    }
  };

  const autoSubmitUnconnected = async (outcome) => {
    if (!activeCall || isSubmitting) return;
    setIsSubmitting(true);
    const callRecord = {
      id: Date.now().toString(),
      number: activeCall.phoneNumber,
      name: contactName || activeCall.name,
      type: 2, // Outgoing
      duration: 0, // Unconnected call has 0 duration
      date: Date.now(),
      status: outcome,
      syncedBy: user.name,
      syncedByEmpId: user.empId,
      category: user.category,
      description: 'Auto-logged as ' + outcome,
      enquiryReceived: 'No',
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
      const data = await res.json();
      if (res.ok && data.saved && data.sheetsSynced) {
        setLeads(prev => prev.filter(l => l.number !== activeCall.phoneNumber));
        setSelectedLead(null);
        setActiveCall(null);
        stopTimer();
        alert(`Call auto-logged as ${outcome}!`);
        fetchLeads();
        fetchLogs();
      } else if (res.ok && data.saved) {
        alert('Saved in the app, but Google Sheets sync failed. Please retry.');
      } else {
        alert('Failed to save outcome. Please try again.');
      }
    } catch (e) {
      alert('Failed to auto-log outcome. Please try again.');
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
  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("Category created successfully!");
        setNewCategoryName('');
        fetchCategories();
      } else {
        alert(data.message || "Failed to create category");
      }
    } catch (err) {
      alert("Error creating category");
    }
  };

  const handleSaveUser = async (e) => {
    e.preventDefault();
    const endpoint = editingUser ? `${API_BASE}/updateUser` : `${API_BASE}/createUser`;
    const payload = {
      ...userForm,
      reportsTo: editingUser ? userForm.reportsTo : (
        user.role === 'Manager' && userForm.role === 'TL' ? user.empId : 
        user.role === 'TL' ? user.empId : userForm.reportsTo || user.empId
      )
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(editingUser ? "User updated successfully!" : "User created successfully!");
        setShowUserModal(false);
        setEditingUser(null);
        setUserForm({ name: '', email: '', phone: '', empId: '', password: '', role: 'Executive', reportsTo: '', category: '' });
        fetchAllUsers();
      } else {
        alert(data.message || "Operation failed");
      }
    } catch (err) {
      alert("Connection error");
    }
  };

  const handleDeleteUser = async (empId) => {
    if (!window.confirm(`Are you sure you want to delete user ${empId}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/deleteUser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("User deleted successfully!");
        fetchAllUsers();
      } else {
        alert(data.message || "Delete failed");
      }
    } catch (err) {
      alert("Error deleting user");
    }
  };

  const handleAssignLeads = async (e) => {
    e.preventDefault();
    const numbers = assignForm.numbersText.split(/[\n,]+/).map(n => n.trim()).filter(Boolean);
    if (numbers.length === 0) {
      alert("Please enter at least one number.");
      return;
    }
    if (!assignForm.assignedTo) {
      alert("Please select a team member.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/contacts/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numbers,
          assignedTo: assignForm.assignedTo,
          assignedBy: user.empId
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Successfully assigned ${numbers.length} contacts!`);
        setShowAssignModal(false);
        setAssignForm({ numbersText: '', assignedTo: '' });
        fetchLeads();
        fetchTeamLeads();
      } else {
        alert(data.message || "Failed to assign contacts");
      }
    } catch (err) {
      alert("Error assigning contacts");
    }
  };

  const exportToCsv = () => {
    if (filteredLogs.length === 0) {
      alert("No logs to export");
      return;
    }
    const headers = ["ID", "Time", "Executive", "Lead Name", "Phone", "Company", "Address", "Email", "Format", "Duration (sec)", "Outcome", "Enquiry Received", "Notes"];
    const rows = filteredLogs.map(log => [
      log.id,
      new Date(log.date).toLocaleString(),
      log.syncedBy || '',
      log.contactName || log.name || '',
      log.number,
      log.companyName || '',
      log.address || '',
      log.email || '',
      log.format || '',
      log.duration || 0,
      log.status || '',
      log.enquiryReceived || 'No',
      (log.description || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `JJ_CRM_Report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRemoveLead = async (e, number) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to remove lead ${number}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/contacts/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, empId: user.empId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("Lead removed successfully!");
        fetchLeads();
        fetchTeamLeads();
      } else {
        alert(data.message || "Failed to remove lead");
      }
    } catch (err) {
      alert("Error removing lead");
    }
  };

  const formatDuration = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const latestLogsOnly = React.useMemo(() => {
    const latestMap = new Map();
    const sorted = [...logs].sort((a, b) => b.date - a.date);
    for (const log of sorted) {
      if (!latestMap.has(log.number)) {
        latestMap.set(log.number, log);
      }
    }
    return Array.from(latestMap.values());
  }, [logs]);

  // CLIENT SIDE FILTERING LOGS
  const filteredLogs = latestLogsOnly.filter(log => {
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
        matchesStatus = log.type === 3 || log.type === '3' || log.status === 'No Answer' || log.status === 'Not Answering' || log.status === 'Busy' || Number(log.duration) === 0;
      } else {
        matchesStatus = log.status && log.status.toLowerCase() === statusFilter.toLowerCase();
      }
    }

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // METRICS COMPUTATIONS
  const totalCalls = latestLogsOnly.length;
  const interestedCalls = latestLogsOnly.filter(l => l.status && l.status.toLowerCase() === 'interested').length;
  const followUpCalls = latestLogsOnly.filter(l => l.status && l.status.toLowerCase() === 'follow up').length;
  const prospectCalls = latestLogsOnly.filter(l => l.status && l.status.toLowerCase() === 'prospect').length;
  const enquiryCalls = latestLogsOnly.filter(l => l.enquiryReceived && l.enquiryReceived.toLowerCase() === 'yes').length;
  const missedCalls = latestLogsOnly.filter(l => l.type === 3 || l.type === '3' || l.status === 'No Answer' || l.status === 'Not Answering' || l.status === 'Busy' || Number(l.duration) === 0).length;

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
  const interestedList = latestLogsOnly.filter(l => l.status && l.status.toLowerCase() === 'interested').slice(0, 20);
  const followUpList = latestLogsOnly.filter(l => l.status && l.status.toLowerCase() === 'follow up').slice(0, 20);
  const prospectList = latestLogsOnly.filter(l => l.status && l.status.toLowerCase() === 'prospect').slice(0, 20);

  // Group outcomes for Doughnut Chart
  const outcomeCounts = {
    'Interested': 0,
    'Follow Up': 0,
    'Prospect': 0,
    'Missed/Busy': 0,
    'Enquiry Received': 0,
    'Called': 0,
    'Other': 0
  };

  filteredLogs.forEach(log => {
    const status = log.status || 'Pending';
    const enquiry = log.enquiryReceived;
    if (status === 'Interested' && enquiry === 'Yes') {
      outcomeCounts['Enquiry Received']++;
    } else if (status === 'Interested') {
      outcomeCounts['Interested']++;
    } else if (status === 'Follow Up') {
      outcomeCounts['Follow Up']++;
    } else if (status === 'Prospect') {
      outcomeCounts['Prospect']++;
    } else if (status === 'Busy' || status === 'No Answer' || status === 'Not Answering' || status === 'Not Interested' || Number(log.duration) === 0) {
      outcomeCounts['Missed/Busy']++;
    } else if (status === 'Called') {
      outcomeCounts['Called']++;
    } else {
      outcomeCounts['Other']++;
    }
  });

  const doughnutLabels = Object.keys(outcomeCounts).filter(k => outcomeCounts[k] > 0 || k === 'Interested' || k === 'Follow Up');
  const doughnutData = {
    labels: doughnutLabels,
    datasets: [{
      data: doughnutLabels.map(k => outcomeCounts[k]),
      backgroundColor: [
        '#10B981', // Interested
        '#F59E0B', // Follow Up
        '#8B5CF6', // Prospect
        '#EF4444', // Missed/Busy
        '#3B82F6', // Enquiry Received
        '#6B7280', // Called
        '#EC4899'  // Other
      ],
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)'
    }]
  };

  // Group Hourly dial times for Line Chart
  const hourlyBins = {};
  for (let i = 9; i <= 18; i++) {
    const label = `${i > 12 ? i - 12 : i}:00 ${i >= 12 ? 'PM' : 'AM'}`;
    hourlyBins[label] = 0;
  }
  
  filteredLogs.forEach(log => {
    const date = new Date(log.date);
    const hour = date.getHours();
    if (hour >= 9 && hour <= 18) {
      const label = `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`;
      hourlyBins[label]++;
    }
  });

  const hourlyData = {
    labels: Object.keys(hourlyBins),
    datasets: [{
      label: 'Hourly Calls',
      data: Object.values(hourlyBins),
      borderColor: '#3B82F6',
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      fill: true,
      tension: 0.3,
      pointRadius: 4,
      pointBackgroundColor: '#3B82F6'
    }]
  };

  // Group daily call count (Last 7 Days) for Bar Chart
  const dailyBins = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateString = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    dailyBins[dateString] = 0;
  }

  filteredLogs.forEach(log => {
    const dateString = new Date(log.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (dailyBins[dateString] !== undefined) {
      dailyBins[dateString]++;
    }
  });

  const dailyData = {
    labels: Object.keys(dailyBins),
    datasets: [{
      label: 'Daily Count',
      data: Object.values(dailyBins),
      backgroundColor: 'rgba(139, 92, 246, 0.65)',
      borderColor: '#8B5CF6',
      borderWidth: 1,
      borderRadius: 4
    }]
  };

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
          {user.role !== 'Executive' && (
            <div style={{ display: 'flex', gap: '10px', marginRight: '15px' }}>
              <button 
                onClick={() => setActiveTab('dashboard')} 
                className="btn-logout"
                style={activeTab === 'dashboard' ? { background: 'var(--accent-gradient)', borderColor: 'transparent', color: 'white' } : {}}
              >
                📊 Dashboard
              </button>
              <button 
                onClick={() => setActiveTab('team')} 
                className="btn-logout"
                style={activeTab === 'team' ? { background: 'var(--accent-gradient)', borderColor: 'transparent', color: 'white' } : {}}
              >
                👥 Team
              </button>
              <button 
                onClick={() => setActiveTab('leads')} 
                className="btn-logout"
                style={activeTab === 'leads' ? { background: 'var(--accent-gradient)', borderColor: 'transparent', color: 'white' } : {}}
              >
                📞 Leads
              </button>
            </div>
          )}
          <div className="user-info">
            <div className="profile-name">{user.name}</div>
            <div className="profile-role">{user.role} Dashboard (ID: {user.empId})</div>
          </div>
          {(user.role === 'Manager' || user.role === 'TL') && (
            <button onClick={syncGoogleSheet} className="btn-logout" style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'var(--success)', color: 'var(--success)' }}>
              {syncStatus || 'Sync Leads'}
            </button>
          )}
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
              <span className="filter-label">{user.role === 'Admin' ? 'MANAGER:' : 'EXECUTIVE:'}</span>
              <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)} className="filter-select">
                {user.role === 'Admin' ? (
                  <>
                    <option value="">Select a Manager...</option>
                    {teamMembers.filter(m => m.role === 'Manager').map(m => (
                      <option key={m.empId} value={m.empId}>{m.name} (Manager)</option>
                    ))}
                  </>
                ) : (
                  <>
                    <option value="All">All Team</option>
                    {teamMembers.map(m => <option key={m.empId} value={m.empId}>{m.name} ({m.role})</option>)}
                  </>
                )}
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

          {user.role !== 'Executive' && (
            <button 
              onClick={() => setShowCharts(!showCharts)} 
              className="btn-clear" 
              style={{ 
                background: showCharts ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.15)', 
                borderColor: showCharts ? '#10B981' : 'var(--info)', 
                color: showCharts ? '#10B981' : 'var(--info)', 
                marginRight: '8px' 
              }}
            >
              {showCharts ? '📊 Hide Analytics' : '📊 Show Analytics'}
            </button>
          )}
          <button onClick={exportToCsv} className="btn-clear" style={{ background: 'rgba(59, 130, 246, 0.15)', borderColor: 'var(--info)', color: 'var(--info)', marginRight: '8px' }}>
            📥 Export CSV
          </button>
          <button onClick={clearFilters} className="btn-clear">
            Clear Filters
          </button>
        </div>
      </div>

      {/* DASHBOARD CONTENT CONTAINER */}
      <div className="main-content" style={{ maxWidth: '100%', width: '100%', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {activeTab === 'dashboard' ? (
          <>
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

            {/* GRAPHICAL ANALYTICS CHARTS SECTION */}
            {showCharts && user.role !== 'Executive' && (
              <div className="stat-card" style={{ padding: '20px', width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '20px', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📈 Visual Performance Trends & Hourly Analytics
                </h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                  
                  {/* Chart 1: Call Outcomes Comparison */}
                  <div style={{ background: 'var(--bg-primary)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '380px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '15px', color: 'var(--text-secondary)' }}>📊 Overall Status Distribution</h4>
                    <div style={{ width: '100%', height: '280px', display: 'flex', justifyContent: 'center' }}>
                      <Doughnut 
                        data={doughnutData} 
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: 'bottom',
                              labels: { color: 'rgba(255,255,255,0.7)', font: { size: 11 } }
                            }
                          }
                        }} 
                      />
                    </div>
                  </div>

                  {/* Chart 2: Hourly Activity Trend */}
                  <div style={{ background: 'var(--bg-primary)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', minHeight: '380px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '15px', color: 'var(--text-secondary)' }}>🕒 Hourly Dialing Performance (9 AM - 6 PM)</h4>
                    <div style={{ height: '280px' }}>
                      <Line 
                        data={hourlyData} 
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { display: false } },
                          scales: {
                            y: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: 'rgba(255,255,255,0.6)' } },
                            x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } }
                          }
                        }} 
                      />
                    </div>
                  </div>

                  {/* Chart 3: Weekly Activity Trend */}
                  <div style={{ background: 'var(--bg-primary)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)', minHeight: '380px' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '15px', color: 'var(--text-secondary)' }}>📅 Daily Call Volume (Last 7 Days)</h4>
                    <div style={{ height: '280px' }}>
                      <Bar 
                        data={dailyData} 
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: { legend: { display: false } },
                          scales: {
                            y: { grid: { color: 'rgba(255,255,255,0.08)' }, ticks: { color: 'rgba(255,255,255,0.6)' } },
                            x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } }
                          }
                        }} 
                      />
                    </div>
                  </div>

                </div>
              </div>
            )}

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
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <div>
                          <div className="lead-name">{lead.name || 'Unnamed Lead'}</div>
                          <div className="lead-phone">
                            📞 {lead.number}
                            <button 
                              onClick={(e) => { e.stopPropagation(); fetchContactHistory(lead.number); }}
                              style={{ marginLeft: '10px', background: 'transparent', border: 'none', color: '#60a5fa', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                              History
                            </button>
                          </div>
                        </div>
                        {user.role !== 'Executive' && (
                          <button 
                            onClick={(e) => handleRemoveLead(e, lead.number)}
                            className="btn-logout"
                            style={{ padding: '4px 8px', fontSize: '11px', borderColor: 'var(--danger)', color: 'var(--danger)', background: 'transparent' }}
                          >
                            Remove
                          </button>
                        )}
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
                        <h4 className="outcome-title">Call Outcome (Duration: {formatDuration(callTimer)})</h4>
                        <div className="outcome-options" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                          {['Interested', 'Follow Up', 'Prospect', 'Not Interested', 'Busy', 'Not Answering'].map(outcome => (
                            <button 
                              key={outcome} 
                              className={`outcome-btn ${callOutcome === outcome ? 'active' : ''}`}
                              onClick={() => handleCallOutcomeClick(outcome)}
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
                            <td>
                              <span 
                                onClick={() => fetchContactHistory(log.number)} 
                                style={{ cursor: 'pointer', textDecoration: 'underline', color: '#60a5fa' }}
                                title="Click to view history"
                              >
                                {log.number}
                              </span>
                            </td>
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

                {/* HOURLY PERFORMANCE REPORT TABLE */}
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
          </>
        ) : activeTab === 'team' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '350px minmax(0, 1fr)', gap: '20px', width: '100%', alignItems: 'start' }}>
            
            {/* LEFT CONTROL PANEL */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Category form (Admin only) */}
              {user.role === 'Admin' && (
                <div className="stat-card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px', color: 'var(--accent-secondary)' }}>Add Category</h3>
                  <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: '10px' }}>
                    <input 
                      type="text" 
                      placeholder="Category Name" 
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      className="form-input"
                      style={{ padding: '10px 12px' }}
                      required
                    />
                    <button type="submit" className="btn-logout" style={{ background: 'var(--accent-gradient)', borderColor: 'transparent', color: 'white', whiteSpace: 'nowrap' }}>
                      Add
                    </button>
                  </form>
                </div>
              )}

              {/* Assign Leads Form (Manager & TL only) */}
              {(user.role === 'Manager' || user.role === 'TL') && (
                <div className="stat-card" style={{ padding: '20px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px', color: 'var(--success)' }}>Assign Leads</h3>
                  <form onSubmit={handleAssignLeads}>
                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label className="form-label">Phone Numbers</label>
                      <textarea
                        placeholder="Enter phone numbers (one per line or separated by commas)"
                        value={assignForm.numbersText}
                        onChange={(e) => setAssignForm({ ...assignForm, numbersText: e.target.value })}
                        className="form-input"
                        rows="4"
                        style={{ padding: '10px 12px', resize: 'vertical' }}
                        required
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: '15px' }}>
                      <label className="form-label">Assign To</label>
                      <select
                        value={assignForm.assignedTo}
                        onChange={(e) => setAssignForm({ ...assignForm, assignedTo: e.target.value })}
                        className="filter-select"
                        style={{ width: '100%', padding: '10px' }}
                        required
                      >
                        <option value="">Select subordinate...</option>
                        {teamMembers.map(m => (
                          <option key={m.empId} value={m.empId}>{m.name} ({m.role})</option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className="btn-primary" style={{ padding: '12px', fontSize: '14px' }}>
                      Assign Contacts
                    </button>
                  </form>
                </div>
              )}

              {/* Add User Control Card */}
              <div className="stat-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>Manage Team</h3>
                <button 
                  onClick={() => {
                    setEditingUser(null);
                    setUserForm({
                      name: '',
                      email: '',
                      phone: '',
                      empId: '',
                      password: '',
                      role: user.role === 'Admin' ? 'Manager' : (user.role === 'Manager' ? 'TL' : 'Executive'),
                      reportsTo: user.empId,
                      category: ''
                    });
                    setShowUserModal(true);
                  }}
                  className="btn-primary"
                  style={{ padding: '12px', fontSize: '14px' }}
                >
                  ➕ Add {user.role === 'Admin' ? 'Manager' : (user.role === 'Manager' ? 'TL / Executive' : 'Executive')}
                </button>
              </div>

            </div>

            {/* RIGHT PANEL - SUBORDINATES LIST */}
            <div className="history-box" style={{ margin: 0, padding: '20px', display: 'flex', flexDirection: 'column', minHeight: '600px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>👥 Team Members Directory</h3>
                <span className="badge-perf badge-perf-excellent" style={{ padding: '6px 12px' }}>
                  {teamMembers.length} Active Subordinates
                </span>
              </div>

              <div className="table-wrapper" style={{ maxHeight: '700px', flex: 1 }}>
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Emp ID</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Reports To</th>
                      <th>Category</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamMembers.map(m => (
                      <tr key={m.empId}>
                        <td><strong>{m.empId}</strong></td>
                        <td>{m.name}</td>
                        <td>
                          <span className={`badge-outcome ${m.role?.toLowerCase() === 'manager' ? 'interested' : (m.role?.toLowerCase() === 'tl' ? 'follow-up' : 'prospect')}`}>
                            {m.role || 'Executive'}
                          </span>
                        </td>
                        <td>{m.email || '-'}</td>
                        <td>{m.phone || '-'}</td>
                        <td>{m.reportsTo || 'System Admin'}</td>
                        <td>{m.category || '-'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              onClick={() => {
                                setEditingUser(m);
                                setUserForm({
                                  name: m.name || '',
                                  email: m.email || '',
                                  phone: m.phone || '',
                                  empId: m.empId || '',
                                  password: '',
                                  role: m.role || 'Executive',
                                  reportsTo: m.reportsTo || '',
                                  category: m.category || ''
                                });
                                setShowUserModal(true);
                              }}
                              className="btn-logout"
                              style={{ padding: '4px 8px', fontSize: '11px', borderColor: 'var(--info)', color: 'var(--info)' }}
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => handleDeleteUser(m.empId)}
                              className="btn-logout"
                              style={{ padding: '4px 8px', fontSize: '11px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {teamMembers.length === 0 && (
                      <tr>
                        <td colSpan="8" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                          No team members found. Start by creating one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '350px minmax(0, 1fr)', gap: '20px', width: '100%', alignItems: 'start' }}>
            {/* LEFT CONTROL PANEL - LEADS TAB */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="stat-card" style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '15px', color: 'var(--success)' }}>Assign New Leads</h3>
                <form onSubmit={handleAssignLeads}>
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label className="form-label">Phone Numbers</label>
                    <textarea
                      placeholder="Enter phone numbers (one per line or separated by commas)"
                      value={assignForm.numbersText}
                      onChange={(e) => setAssignForm({ ...assignForm, numbersText: e.target.value })}
                      className="form-input"
                      rows="5"
                      style={{ padding: '10px 12px', resize: 'vertical' }}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: '15px' }}>
                    <label className="form-label">Assign To</label>
                    <select
                      value={assignForm.assignedTo}
                      onChange={(e) => setAssignForm({ ...assignForm, assignedTo: e.target.value })}
                      className="filter-select"
                      style={{ width: '100%', padding: '10px' }}
                      required
                    >
                      <option value="">Select recipient...</option>
                      {allUsers.map(m => (
                        <option key={m.empId} value={m.empId}>{m.name} ({m.role})</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn-primary" style={{ padding: '12px', fontSize: '14px' }}>
                    Assign Contacts
                  </button>
                </form>
              </div>

              <div className="stat-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>Google Sheet Integration</h3>
                <button 
                  onClick={syncGoogleSheet} 
                  className="btn-primary"
                  style={{ background: 'var(--success)', padding: '12px', fontSize: '14px' }}
                >
                  {syncStatus || '🔄 Sync Leads from Sheet'}
                </button>
              </div>
            </div>

            {/* RIGHT PANEL - LEADS DIRECTORY TABLE */}
            <div className="history-box" style={{ margin: 0, padding: '20px', display: 'flex', flexDirection: 'column', minHeight: '600px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>📞 Team Leads Directory</h3>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                  {user.role === 'Admin' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Filter Manager:</span>
                      <select 
                        value={selectedLeadManager} 
                        onChange={(e) => setSelectedLeadManager(e.target.value)} 
                        className="filter-select"
                        style={{ padding: '6px 12px', fontSize: '13px', background: 'var(--bg-secondary)', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                      >
                        <option value="All">All Managers</option>
                        {allUsers.filter(m => m.role === 'Manager').map(m => (
                          <option key={m.empId} value={m.empId}>{m.name} (ID: {m.empId})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <span className="badge-perf badge-perf-excellent" style={{ padding: '6px 12px' }}>
                    {teamLeads.length} Leads Total
                  </span>
                </div>
              </div>

              <div className="table-wrapper" style={{ maxHeight: '700px', flex: 1 }}>
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Phone</th>
                      <th>Name</th>
                      <th>Assigned To</th>
                      <th>Assigned By</th>
                      <th>Assigned At</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamLeads.map(lead => (
                      <tr key={lead.number}>
                        <td>
                          <strong 
                            onClick={() => fetchContactHistory(lead.number)} 
                            style={{ cursor: 'pointer', textDecoration: 'underline', color: '#60a5fa' }}
                            title="Click to view history"
                          >
                            {lead.number}
                          </strong>
                        </td>
                        <td>{lead.name || 'Unnamed Lead'}</td>
                        <td>
                          <span style={{ fontWeight: '600' }}>
                            {lead.assignedToName || 'Unknown'} (ID: {lead.assignedTo})
                          </span>
                        </td>
                        <td>{lead.assignedByName || 'System'}</td>
                        <td>{lead.assignedAt ? new Date(lead.assignedAt).toLocaleString() : '-'}</td>
                        <td>
                          <span className={`badge-outcome ${lead.status?.toLowerCase() === 'pending' ? 'follow-up' : 'busy'}`}>
                            {lead.status || 'Pending'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              onClick={(e) => handleRemoveLead(e, lead.number)}
                              className="btn-logout"
                              style={{ padding: '4px 8px', fontSize: '11px', borderColor: 'var(--danger)', color: 'var(--danger)', background: 'transparent' }}
                            >
                              Remove
                            </button>
                            <button 
                              onClick={() => {
                                setTransferringLead(lead);
                                setTransferToEmpId('');
                              }}
                              className="btn-logout"
                              style={{ padding: '4px 8px', fontSize: '11px', borderColor: 'var(--info)', color: 'var(--info)', background: 'transparent' }}
                            >
                              Transfer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {teamLeads.length === 0 && (
                      <tr>
                        <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-secondary)' }}>
                          No leads assigned. Sync from sheet or input manually.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ADD / EDIT USER OVERLAY MODAL */}
      {showUserModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="auth-card" style={{ maxWidth: '550px', padding: '30px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '20px', color: 'white' }}>
              {editingUser ? `✏️ Edit Profile: ${editingUser.name}` : '➕ Add Team Member'}
            </h3>
            
            <form onSubmit={handleSaveUser}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input 
                    type="text" 
                    value={userForm.name} 
                    onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                    className="form-input"
                    placeholder="John Doe"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Employee ID</label>
                  <input 
                    type="text" 
                    value={userForm.empId} 
                    onChange={(e) => setUserForm({ ...userForm, empId: e.target.value })}
                    className="form-input"
                    placeholder="Numeric ID (leave empty for auto)"
                    disabled={!!editingUser}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input 
                    type="email" 
                    value={userForm.email} 
                    onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                    className="form-input"
                    placeholder="john@example.com"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Phone Number</label>
                  <input 
                    type="text" 
                    value={userForm.phone} 
                    onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                    className="form-input"
                    placeholder="10-digit number"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input 
                    type="password" 
                    value={userForm.password} 
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    className="form-input"
                    placeholder={editingUser ? "Leave blank to keep current" : "••••••••"}
                    required={!editingUser}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Select Role</label>
                  <select 
                    value={userForm.role} 
                    onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                    className="filter-select"
                    style={{ width: '100%', padding: '12px' }}
                    required
                  >
                    {user.role === 'Admin' && <option value="Manager">Manager</option>}
                    {user.role === 'Admin' && <option value="TL">Team Leader</option>}
                    {user.role === 'Admin' && <option value="Executive">Executive</option>}
                    {user.role === 'Manager' && <option value="TL">Team Leader</option>}
                    {user.role === 'Manager' && <option value="Executive">Executive</option>}
                    {user.role === 'TL' && <option value="Executive">Executive</option>}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Reports To (Emp ID)</label>
                  <input 
                    type="text" 
                    value={userForm.reportsTo} 
                    onChange={(e) => setUserForm({ ...userForm, reportsTo: e.target.value })}
                    className="form-input"
                    placeholder="Reports to ID"
                    required={userForm.role !== 'Manager'}
                    disabled={user.role !== 'Admin'} // Direct reports to Managers/TLs are pre-assigned unless Admin edits
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Assign Category</label>
                  <select 
                    value={userForm.category} 
                    onChange={(e) => setUserForm({ ...userForm, category: e.target.value })}
                    className="filter-select"
                    style={{ width: '100%', padding: '12px' }}
                  >
                    <option value="">No Specific Category</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '12px' }}>
                  Save User
                </button>
                <button 
                  type="button" 
                  onClick={() => { setShowUserModal(false); setEditingUser(null); }} 
                  className="btn-logout"
                  style={{ flex: 1, padding: '12px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TRANSFER LEAD OVERLAY MODAL */}
      {transferringLead && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1001,
          padding: '20px'
        }}>
          <div className="auth-card" style={{ maxWidth: '400px', padding: '30px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '15px' }}>
              🔄 Transfer Lead: {transferringLead.number}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Current Assignee: {transferringLead.assignedToName || 'Unknown'} (ID: {transferringLead.assignedTo})
            </p>
            
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">Transfer To</label>
              <select
                value={transferToEmpId}
                onChange={(e) => setTransferToEmpId(e.target.value)}
                className="filter-select"
                style={{ width: '100%', padding: '10px' }}
                required
              >
                <option value="">Select recipient...</option>
                {allUsers.map(m => (
                  <option key={m.empId} value={m.empId}>{m.name} ({m.role})</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '15px' }}>
              <button 
                onClick={async () => {
                  if (!transferToEmpId) return;
                  try {
                    const res = await fetch(`${API_BASE}/contacts/assign`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        numbers: [transferringLead.number],
                        assignedTo: transferToEmpId,
                        assignedBy: user.empId
                      })
                    });
                    const data = await res.json();
                    if (res.ok && data.success) {
                      alert("Lead transferred successfully!");
                      setTransferringLead(null);
                      fetchLeads();
                      fetchTeamLeads();
                    } else {
                      alert(data.message || "Failed to transfer");
                    }
                  } catch (err) {
                    alert("Error transferring lead");
                  }
                }}
                className="btn-primary" 
                style={{ flex: 1, padding: '12px' }}
              >
                Confirm
              </button>
              <button 
                onClick={() => setTransferringLead(null)} 
                className="btn-logout"
                style={{ flex: 1, padding: '12px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONTACT HISTORY OVERLAY MODAL */}
      {showHistoryModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1002,
          padding: '20px'
        }}>
          <div className="auth-card" style={{ maxWidth: '700px', width: '100%', padding: '30px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '20px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>📜 Call History for {historyNumber}</span>
              <button 
                onClick={() => setShowHistoryModal(false)}
                className="btn-logout"
                style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid var(--border-color)', background: 'transparent' }}
              >
                Close
              </button>
            </h3>
            
            <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {historyLogs.map(hLog => (
                <div key={hLog.id} style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                    <strong>{new Date(hLog.date).toLocaleString()}</strong>
                    <span className={`badge-outcome ${hLog.status?.toLowerCase().replace(' ', '-') || 'busy'}`}>
                      {hLog.status || 'No Status'}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    <div><strong>Caller:</strong> {hLog.syncedBy || '-'}</div>
                    <div><strong>Format:</strong> {hLog.format || '-'}</div>
                    <div><strong>Company:</strong> {hLog.companyName || '-'}</div>
                    <div><strong>Duration:</strong> {hLog.duration}s</div>
                  </div>
                  <div style={{ fontSize: '13px', color: '#ccc' }}>
                    <strong>Note:</strong> {hLog.description || '-'}
                  </div>
                </div>
              ))}
              {historyLogs.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No previous call records found.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

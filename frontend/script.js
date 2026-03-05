// frontend/script.js
// ListaTrust Frontend JavaScript

// ============ GLOBAL VARIABLES ============
const token = localStorage.getItem('token');
let currentUser = null;
let aiServiceStatus = 'checking';

// ============ HELPER FUNCTIONS ============
function getCurrentPage() {
    return window.location.pathname.split('/').pop() || '';
}

// ============ AUTH CHECK - Only runs on dashboard ============
(function() {
    const currentPage = getCurrentPage();
    
    // Only run auth check on dashboard
    if (currentPage === 'dashboard.html') {
        if (!token) {
            console.log('🔒 No token found - redirecting to login');
            window.location.href = 'login.html';
            return;
        }
        
        // Verify token with backend
        fetch('http://127.0.0.1:3000/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (!res.ok) {
                console.log('🔒 Token invalid - clearing and redirecting');
                localStorage.clear();
                window.location.href = 'login.html';
            }
            return res.json();
        })
        .then(user => {
            console.log('✅ Authenticated as:', user.username);
        })
        .catch(err => {
            console.error('Auth error:', err);
            localStorage.clear();
            window.location.href = 'login.html';
        });
    }
})();

// ============ PAGE NAVIGATION (dashboard only) ============
function showPage(page) {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
    document.getElementById(`page-${page}`).classList.remove('hidden');
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    event.target.classList.add('active');
}

function filterCards(query) {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const q = query.toLowerCase();
    document.querySelectorAll('.debtor-card').forEach(card => {
        const name = card.getAttribute('data-name')?.toLowerCase() || '';
        card.style.display = name.includes(q) ? 'flex' : 'none';
    });
}

// ============ PROFILE FUNCTIONS (dashboard only) ============
function updateNavbarAvatar() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const avatarDiv = document.getElementById('userAvatar');
    const initialsSpan = document.getElementById('userInitials');
    
    if (currentUser && currentUser.profile_photo) {
        avatarDiv.style.backgroundImage = `url('http://127.0.0.1:3000/uploads/${currentUser.profile_photo}')`;
        avatarDiv.style.backgroundColor = 'transparent';
        initialsSpan.style.display = 'none';
    } else {
        avatarDiv.style.backgroundImage = 'none';
        avatarDiv.style.backgroundColor = '#9ccc65';
        initialsSpan.style.display = 'flex';
        const initials = (currentUser?.first_name?.[0] || currentUser?.username?.[0] || 'U').toUpperCase();
        initialsSpan.textContent = initials;
    }
}

function showProfileModal() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    document.getElementById('profileUsername').value = currentUser.username || '';
    document.getElementById('profileEmail').value = currentUser.email || '';
    document.getElementById('profileName').value = `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim();
    document.getElementById('profileWallet').value = currentUser.wallet_address || 'No wallet assigned';
    
    if (currentUser.profile_photo) {
        document.getElementById('profilePreview').src = `http://127.0.0.1:3000/uploads/${currentUser.profile_photo}`;
    } else {
        document.getElementById('profilePreview').src = 'https://via.placeholder.com/100';
    }
    
    document.getElementById('profileModal').style.display = 'block';
}

async function uploadProfilePhoto(input) {
    if (getCurrentPage() !== 'dashboard.html' || !input.files[0]) return;

    const formData = new FormData();
    formData.append('photo', input.files[0]);

    const res = await fetch('http://127.0.0.1:3000/api/users/profile-photo', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });

    if (res.ok) {
        const data = await res.json();
        document.getElementById('profilePreview').src = data.url;
        
        const userRes = await fetch('http://127.0.0.1:3000/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        currentUser = await userRes.json();
        
        updateNavbarAvatar();
        
        alert('Profile photo updated!');
    } else {
        const error = await res.json();
        alert('Upload failed: ' + error.error);
    }
}

// ============ AI STATUS CHECK (dashboard only) ============
async function checkAIServiceStatus() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    try {
        const res = await fetch('http://127.0.0.1:3000/api/ai/health', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error('Failed to check AI status');
        
        const data = await res.json();
        const statusBadge = document.getElementById('aiStatusBadge');
        const modelDisplay = document.getElementById('aiModelDisplay');
        
        if (data.status === 'AI Service is running') {
            if (statusBadge) statusBadge.innerHTML = '<span style="color: green; font-weight: bold;">✅ Python AI Online</span>';
            if (modelDisplay) modelDisplay.innerHTML = 'AI Model: Random Forest Classifier (Python)';
            aiServiceStatus = 'python';
            console.log('🤖 Python AI service is ONLINE');
        } else {
            if (statusBadge) statusBadge.innerHTML = '<span style="color: orange; font-weight: bold;">⚠️ Using Fallback AI</span>';
            if (modelDisplay) modelDisplay.innerHTML = 'AI Model: Rule-Based (Fallback)';
            aiServiceStatus = 'fallback';
            console.log('⚠️ Using fallback rule-based AI');
        }
    } catch (error) {
        console.error('AI status check failed:', error);
        const statusBadge = document.getElementById('aiStatusBadge');
        const modelDisplay = document.getElementById('aiModelDisplay');
        if (statusBadge) {
            statusBadge.innerHTML = '<span style="color: red; font-weight: bold;">❌ AI Offline (Using Fallback)</span>';
        }
        if (modelDisplay) {
            modelDisplay.innerHTML = 'AI Model: Rule-Based (Fallback)';
        }
        aiServiceStatus = 'offline';
    }
}

// ============ DASHBOARD LOADING (dashboard only) ============
async function loadDashboard() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    try {
        const userRes = await fetch('http://127.0.0.1:3000/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!userRes.ok) {
            if (userRes.status === 401) {
                localStorage.clear();
                window.location.href = 'login.html';
                return;
            }
        }
        
        currentUser = await userRes.json();
        
        document.getElementById('userNameDisplay').textContent = currentUser.first_name || currentUser.username;
        updateNavbarAvatar();

        document.getElementById('myWallet').textContent = currentUser.wallet_address ? 
            currentUser.wallet_address.substring(0, 6) + '...' + currentUser.wallet_address.substring(38) : 
            'No wallet';

        const statsRes = await fetch('http://127.0.0.1:3000/api/dashboard/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const stats = await statsRes.json();

        document.getElementById('totalDebtors').textContent = stats.totalDebtors;
        document.getElementById('pendingAmount').textContent = `₱${stats.pendingAmount.toLocaleString()}`;
        document.getElementById('collectedAmount').textContent = `₱${stats.collectedAmount.toLocaleString()}`;
        document.getElementById('totalTransactions').textContent = stats.totalTransactions;

        if (stats.blockchainTotal !== undefined) {
            document.getElementById('blockchainTotal').textContent = stats.blockchainTotal;
            document.getElementById('activeBlockchain').textContent = stats.activeBlockchain;
        }

        stats.trustLevels.forEach(level => {
            if (level.trust_level === 'HIGH') document.getElementById('highCount').textContent = level.count;
            if (level.trust_level === 'MEDIUM') document.getElementById('mediumCount').textContent = level.count;
            if (level.trust_level === 'LOW') document.getElementById('lowCount').textContent = level.count;
        });

        await checkAIServiceStatus();
        loadDebtors();
        loadTransactions();

    } catch (error) {
        console.error('Dashboard error:', error);
    }
}

async function loadDebtors() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    try {
        const res = await fetch('http://127.0.0.1:3000/api/debtors', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) return;
        
        const debtors = await res.json();
        const container = document.getElementById('debtorsCards');
        
        if (debtors.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;"><i class="fa-regular fa-folder-open" style="font-size: 48px; margin-bottom: 10px;"></i><br>No debtors yet</div>';
            return;
        }

        container.innerHTML = debtors.map(d => `
            <div class="debtor-card" data-name="${d.first_name} ${d.last_name}">
                <div class="avatar">
                    ${d.photo ? 
                        `<img src="http://127.0.0.1:3000/uploads/${d.photo}" alt="${d.first_name}">` : 
                        `<i class="fa-regular fa-user" style="font-size: 30px; color: #2f6db2;"></i>`
                    }
                </div>
                <div class="info">
                    <h3>${d.first_name} ${d.last_name}</h3>
                    <p><i class="fa-regular fa-phone" style="margin-right: 5px;"></i>${d.phone || 'No phone'}</p>
                    <p style="font-size: 11px; color: #999;">ID: ${d.debtor_id}</p>
                    <span class="${d.trust_level === 'HIGH' ? 'success' : d.trust_level === 'MEDIUM' ? 'pending' : 'danger'}" 
                          title="AI Score: ${d.trust_score}% - ${d.trust_level} Risk">
                        ${d.trust_level} (${d.trust_score}%)
                    </span>
                </div>
                <div class="debt">
                    <p>Current Debt</p>
                    <h3>₱${(d.total_borrowed - d.total_repaid).toLocaleString()}</h3>
                </div>
                <div class="actions">
                    <a onclick="editDebtor('${d.debtor_id}', '${d.first_name}', '${d.last_name}', '${d.phone || ''}', '${d.email || ''}')">
                        <i class="fa-regular fa-pen-to-square"></i> Edit
                    </a>
                    <a onclick="deleteDebtor('${d.debtor_id}')" style="color: #b22222;">
                        <i class="fa-regular fa-trash-can"></i> Delete
                    </a>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load debtors error:', error);
    }
}

async function loadTransactions() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    try {
        const res = await fetch('http://127.0.0.1:3000/api/debtors', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) return;
        
        const debtors = await res.json();
        let allTransactions = [];
        
        for (const debtor of debtors.slice(0, 5)) {
            const txnRes = await fetch(`http://127.0.0.1:3000/api/transactions/debtor/${debtor.debtor_id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (txnRes.ok) {
                const txns = await txnRes.json();
                allTransactions = [...allTransactions, ...txns];
            }
        }

        const container = document.getElementById('transactionsCards');
        
        if (allTransactions.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;"><i class="fa-regular fa-clock" style="font-size: 48px; margin-bottom: 10px;"></i><br>No transactions yet</div>';
            return;
        }

        container.innerHTML = allTransactions.slice(0, 10).map(t => `
            <div class="debtor-card">
                <div class="avatar">
                    <i class="fa-regular ${t.type === 'BORROW' ? 'fa-arrow-right-to-bracket' : 'fa-arrow-left-from-bracket'}" style="font-size: 30px; color: #2f6db2;"></i>
                </div>
                <div class="info">
                    <h3>${t.transaction_id}</h3>
                    <p><i class="fa-regular fa-calendar" style="margin-right: 5px;"></i>${new Date(t.created_at).toLocaleDateString()}</p>
                    <span class="${t.status === 'PENDING' ? 'pending' : 'success'}">${t.status}</span>
                </div>
                <div class="debt">
                    <p>${t.type}</p>
                    <h3>₱${t.amount.toLocaleString()}</h3>
                </div>
                <div class="actions">
                    ${t.status === 'PENDING' ? 
                        `<a onclick="editTransaction('${t.transaction_id}')"><i class="fa-regular fa-pen-to-square"></i> Edit</a>` : 
                        ''}
                    <a onclick="markAsPaid('${t.transaction_id}')" style="color: #63c132;">
                        <i class="fa-regular fa-circle-check"></i> Pay
                    </a>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Load transactions error:', error);
    }
}

// ============ DEBTOR FUNCTIONS (dashboard only) ============
// Add Debtor Form
document.addEventListener('DOMContentLoaded', function() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const addDebtorForm = document.getElementById('addDebtorForm');
    if (addDebtorForm) {
        addDebtorForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const debtor = {
                debtorId: document.getElementById('debtorId').value || undefined,
                firstName: document.getElementById('firstName').value,
                lastName: document.getElementById('lastName').value,
                phone: document.getElementById('phone').value
            };

            try {
                const res = await fetch('http://127.0.0.1:3000/api/debtors', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(debtor)
                });

                const data = await res.json();
                
                if (res.ok) {
                    const debtorId = data.debtorId || data.id || 'generated';
                    alert(`Debtor added successfully! ID: ${debtorId}`);
                    loadDebtors();
                    loadDashboard();
                    e.target.reset();
                } else {
                    alert('Error: ' + (data.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Add debtor error:', error);
                alert('Error: ' + error.message);
            }
        });
    }
});

window.editDebtor = (debtorId, firstName, lastName, phone, email) => {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    document.getElementById('editDebtorId').value = debtorId;
    document.getElementById('editFirstName').value = firstName;
    document.getElementById('editLastName').value = lastName;
    document.getElementById('editPhone').value = phone;
    document.getElementById('editEmail').value = email;
    document.getElementById('editDebtorModal').style.display = 'block';
};

// Edit Debtor Form
document.addEventListener('DOMContentLoaded', function() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const editDebtorForm = document.getElementById('editDebtorForm');
    if (editDebtorForm) {
        editDebtorForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const debtorId = document.getElementById('editDebtorId').value;
            const updatedDebtor = {
                firstName: document.getElementById('editFirstName').value,
                lastName: document.getElementById('editLastName').value,
                phone: document.getElementById('editPhone').value,
                email: document.getElementById('editEmail').value
            };

            const res = await fetch(`http://127.0.0.1:3000/api/debtors/${debtorId}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(updatedDebtor)
            });

            if (res.ok) {
                alert('Debtor updated!');
                closeModal('editDebtorModal');
                loadDebtors();
            } else {
                const data = await res.json();
                alert(data.error);
            }
        });
    }
});

window.deleteDebtor = async (debtorId) => {
    if (getCurrentPage() !== 'dashboard.html') return;
    if (!confirm('Are you sure you want to delete this debtor?')) return;

    const res = await fetch(`http://127.0.0.1:3000/api/debtors/${debtorId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
        alert('Debtor deleted!');
        loadDebtors();
        loadDashboard();
    } else {
        const data = await res.json();
        alert(data.error);
    }
};

async function uploadDebtorPhoto(input) {
    if (getCurrentPage() !== 'dashboard.html' || !input.files[0]) return;

    const debtorId = document.getElementById('editDebtorId').value;
    const formData = new FormData();
    formData.append('photo', input.files[0]);

    const res = await fetch(`http://127.0.0.1:3000/api/debtors/${debtorId}/photo`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
    });

    if (res.ok) {
        alert('Photo uploaded!');
        loadDebtors();
    }
}

// ============ TRANSACTION FUNCTIONS (dashboard only) ============
// Borrow Form
document.addEventListener('DOMContentLoaded', function() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const borrowForm = document.getElementById('borrowForm');
    if (borrowForm) {
        borrowForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const transaction = {
                debtorId: document.getElementById('borrowDebtorId').value,
                amount: document.getElementById('amount').value,
                items: document.getElementById('items').value,
                dueDate: document.getElementById('dueDate').value
            };

            const res = await fetch('http://127.0.0.1:3000/api/transactions/borrow', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(transaction)
            });

            if (res.ok) {
                alert('Transaction recorded!');
                loadDashboard();
                loadTransactions();
                e.target.reset();
            } else {
                const data = await res.json();
                alert(data.error);
            }
        });
    }
});

window.markAsPaid = async (transactionId) => {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const res = await fetch(`http://127.0.0.1:3000/api/transactions/pay/${transactionId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
        alert('Payment recorded!');
        loadDashboard();
        loadTransactions();
    }
};

window.editTransaction = (transactionId) => {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const newAmount = prompt('Enter new amount:');
    if (newAmount) {
        editTransactionAmount(transactionId, newAmount);
    }
};

async function editTransactionAmount(transactionId, newAmount) {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const res = await fetch(`http://127.0.0.1:3000/api/transactions/${transactionId}`, {
        method: 'PUT',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ amount: newAmount })
    });

    if (res.ok) {
        alert('Transaction updated!');
        loadTransactions();
        loadDashboard();
    } else {
        const data = await res.json();
        alert(data.error);
    }
}

// ============ BLOCKCHAIN FUNCTIONS (dashboard only) ============
// Blockchain Add Form
document.addEventListener('DOMContentLoaded', function() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    const blockchainAddForm = document.getElementById('blockchainAddForm');
    if (blockchainAddForm) {
        blockchainAddForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const itemsInput = document.getElementById('blockchainItems').value;
            const itemsArray = itemsInput.split(/[,\|]/).map(item => item.trim()).filter(item => item);
            const itemsString = itemsArray.join('|');
            
            const data = {
                debtorName: document.getElementById('blockchainDebtorName').value,
                amount: document.getElementById('blockchainAmount').value,
                items: itemsString
            };

            try {
                const res = await fetch('http://127.0.0.1:3000/api/blockchain/add-utang', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(data)
                });

                const result = await res.json();
                
                if (res.ok) {
                    alert(`✅ Debt added to blockchain for ${data.debtorName}! Items: ${itemsArray.join(', ')}`);
                    document.getElementById('blockchainAddForm').reset();
                    loadDashboard();
                    viewMyBlockchainDebts();
                } else {
                    alert('❌ Error: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error: ' + error.message);
            }
        });
    }
});

// View my blockchain debts
window.viewMyBlockchainDebts = async function() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    try {
        const res = await fetch('http://127.0.0.1:3000/api/blockchain/my-utang', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Failed to fetch blockchain debts');

        const debts = await res.json();
        const container = document.getElementById('blockchainDebts');
        
        if (!debts || debts.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;"><i class="fa-regular fa-circle"></i><br>No blockchain debts found</div>';
            return;
        }

        container.innerHTML = debts.map(d => {
            const amount = typeof d.amount === 'bigint' ? Number(d.amount) : parseFloat(d.amount || 0);
            const id = d.id?.toString() || 'unknown';
            const itemsList = d.items ? d.items.split('|').map(i => i.trim()).join(', ') : d.items;
            const timestamp = d.timestamp ? new Date(parseInt(d.timestamp) * 1000).toLocaleDateString() : 'No date';
            
            return `
            <div class="debtor-card">
                <div class="avatar" style="background: #5a3e8a; color: white;">
                    <i class="fa-solid fa-link" style="font-size: 30px;"></i>
                </div>
                <div class="info">
                    <h3>${d.debtorName || 'Unknown'}</h3>
                    <p><i class="fa-regular fa-calendar"></i> ${timestamp}</p>
                    <span class="${d.paid ? 'success' : 'pending'}">${d.paid ? 'Paid' : 'Unpaid'}</span>
                </div>
                <div class="debt">
                    <p>Amount</p>
                    <h3>₱${amount.toLocaleString()}</h3>
                    <small title="${itemsList}">${itemsList ? itemsList.substring(0, 20) + (itemsList.length > 20 ? '...' : '') : 'No items'}</small>
                </div>
                <div class="actions">
                    ${!d.paid ? 
                        `<a onclick="markBlockchainPaid('${id}')" style="color: #63c132;">
                            <i class="fa-regular fa-circle-check"></i> Mark Paid
                        </a>` : 
                        '<span style="color: #999;">Completed</span>'
                    }
                </div>
            </div>
        `}).join('');

    } catch (error) {
        console.error('❌ Error:', error);
        alert('Error: ' + error.message);
    }
};

// Mark blockchain debt as paid
window.markBlockchainPaid = async function(utangId) {
    if (getCurrentPage() !== 'dashboard.html') return;
    if (!confirm('Mark this blockchain debt as paid?')) return;

    try {
        const res = await fetch(`http://127.0.0.1:3000/api/blockchain/mark-paid/${utangId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await res.json();
        
        if (res.ok) {
            alert('✅ Debt marked as paid on blockchain!');
            viewMyBlockchainDebts();
            loadDashboard();
        } else {
            alert('❌ Error: ' + result.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

// Sync blockchain data
window.syncBlockchain = async function() {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    try {
        const res = await fetch('http://127.0.0.1:3000/api/blockchain/sync', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await res.json();
        
        if (res.ok) {
            alert(`✅ Synced ${result.synced} records!`);
            loadDashboard();
        } else {
            alert('❌ Error: ' + result.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

// ============ AI FUNCTIONS (dashboard only) ============
window.getAITrustScore = async function(debtorId) {
    if (getCurrentPage() !== 'dashboard.html') return;
    
    try {
        const res = await fetch(`http://127.0.0.1:3000/api/ai/trust-score/${debtorId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();
        
        if (res.ok) {
            alert(`AI Trust Score: ${data.score}% (${data.level})\nFactors: ${data.factors.join(', ')}`);
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

window.recalculateAIScores = async function() {
    if (getCurrentPage() !== 'dashboard.html') return;
    if (!confirm('Recalculate AI trust scores for ALL debtors? This may take a moment.')) return;

    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Recalculating...';
    btn.disabled = true;

    try {
        const res = await fetch('http://127.0.0.1:3000/api/ai/recalculate-store', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();
        
        if (res.ok) {
            const aiUsed = aiServiceStatus === 'python' ? 'Python AI' : 'Fallback AI';
            alert(`✅ ${data.message}\n🤖 Using: ${aiUsed}`);
            loadDebtors();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// ============ MODAL FUNCTIONS ============
window.closeModal = (modalId) => {
    document.getElementById(modalId).style.display = 'none';
};

window.onclick = (event) => {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
};

// ============ LOGOUT FUNCTIONS ============
function confirmLogout() {
    if (getCurrentPage() !== 'dashboard.html') return;
    document.getElementById('logoutModal').style.display = 'block';
}

function logout() {
    fetch('http://127.0.0.1:3000/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    }).finally(() => {
        localStorage.clear();
        window.location.href = 'login.html';
    });
}

// ============ SESSION CHECK (dashboard only) ============
if (getCurrentPage() === 'dashboard.html') {
    setInterval(async () => {
        try {
            const res = await fetch('http://127.0.0.1:3000/api/auth/me', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!res.ok && res.status === 401) {
                alert('Session expired. Please login again.');
                localStorage.clear();
                window.location.href = 'login.html';
            }
        } catch (error) {
            console.error('Session check error:', error);
        }
    }, 30000);
}

// ============ EXPOSE FUNCTIONS TO WINDOW ============
window.showPage = showPage;
window.filterCards = filterCards;
window.showProfileModal = showProfileModal;
window.uploadProfilePhoto = uploadProfilePhoto;
window.uploadDebtorPhoto = uploadDebtorPhoto;
window.confirmLogout = confirmLogout;
window.logout = logout;
window.getAITrustScore = getAITrustScore;
window.recalculateAIScores = recalculateAIScores;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.includes('dashboard.html')) {
        loadDashboard();
    }
});
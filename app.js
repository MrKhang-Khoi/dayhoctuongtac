/* ==========================================
 * DẠY HỌC TƯƠNG TÁC - APP.JS
 * ========================================== */

/* === 1. FIREBASE CONFIG === */
const firebaseConfig = {
    apiKey: "AIzaSyCC2tCURXYAMpdN687kcjY537K7zUhh_Fg",
    authDomain: "day-hoc-tuong-tac-7ee69.firebaseapp.com",
    databaseURL: "https://day-hoc-tuong-tac-7ee69-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "day-hoc-tuong-tac-7ee69",
    storageBucket: "day-hoc-tuong-tac-7ee69.firebasestorage.app",
    messagingSenderId: "628267818434",
    appId: "1:628267818434:web:a0b8d1ceda61affea20a5b"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* === SAFE LOCAL STORAGE (Tracking Prevention fix) === */
function safeSetItem(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { console.warn('localStorage blocked:', e.message); }
}
function safeGetItem(key) {
    try { return localStorage.getItem(key); } catch (e) { console.warn('localStorage blocked:', e.message); return null; }
}
function safeRemoveItem(key) {
    try { localStorage.removeItem(key); } catch (e) { console.warn('localStorage blocked:', e.message); }
}

/* === 2. GLOBAL STATE === */
const STATE = {
    role: null,           // 'teacher' | 'student'
    studentName: '',
    groupNumber: null,
    roomId: 'main-room',
    currentMode: null,    // 'discussion' | 'quiz'
    selectedTimeDisc: 180,
    selectedQuizType: 'multiple-choice',
    quizSelectedQuestions: [],
    quizCurrentIndex: 0,
    timerInterval: null,
    attachedFiles: [],
    dragData: {},
    editingDiscQId: null,
    editingQuizQId: null,
    timerPaused: false,     // Timer tạm dừng
    timerRemaining: 0,      // Thời gian còn lại
    timerDuration: 0,       // Tổng thời gian
    soundEnabled: true,     // Âm thanh bật/tắt
    randomPickedGroups: [], // Nhóm đã được chọn ngẫu nhiên
    currentDiscQuestionId: null, // ID câu hỏi đang thảo luận
    countdownInterval: null, // Interval cho countdown 3-2-1
    compactAnswers: false,   // Thu gọn câu trả lời
    discImageData: null,      // Base64 hình ảnh câu hỏi thảo luận
    discussionStopped: false, // [BUG 5] Guard: tránh gọi stopDiscussion() 2 lần đồng thời
    loadHistoryTimeout: null, // [BUG 8] Debounce timer cho loadStudentHistory
    // === TEAM/HOMEWORK FIELDS ===
    teamId: null,             // 'to-1', 'to-2'... (tổ của HS)
    teamRole: 'member',       // 'member' | 'leader'
    teamConfig: null          // Cache teamConfig từ Firebase
};
const TEACHER_PASSWORD = 'admin@2025';
const TOTAL_GROUPS = 18;
const TEAM_COLORS = ['#667eea','#f5576c','#ffd700','#00d2ff','#38ef7d','#f093fb','#ff6b6b','#48dbfb','#ff9ff3'];

/* === 3. UI MODULE === */
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}
function showToast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${msg}`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}
function showPanel(panelId) {
    // New layout: td-panel / td-nav-btn
    document.querySelectorAll('.td-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.td-nav-btn').forEach(m => m.classList.remove('active'));
    // Legacy: panel / menu-item
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
    const targetPanel = document.getElementById(panelId);
    if (targetPanel) targetPanel.classList.add('active');
    document.querySelectorAll(`[data-panel="${panelId}"]`).forEach(el => el.classList.add('active'));
}
function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

/* === 4. LOGIN MODULE === */
function initLogin() {
    // Student tab: go to lobby screen
    document.getElementById('btn-student-login').addEventListener('click', () => {
        showScreen('student-lobby');
        initStudentLobby();
    });
    // Teacher login
    document.getElementById('btn-teacher-login').addEventListener('click', loginTeacher);
    // Toggle password
    document.getElementById('toggle-password').addEventListener('click', () => {
        const inp = document.getElementById('teacher-password');
        inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });
}

/* === 4A. STUDENT LOBBY === */
function initStudentLobby() {
    const grid = document.getElementById('lobby-grid');
    grid.innerHTML = '';
    for (let i = 1; i <= TOTAL_GROUPS; i++) {
        const el = document.createElement('div');
        el.className = 'lobby-machine';
        el.dataset.group = i;
        el.innerHTML = `
            <i class="fas fa-desktop lm-icon"></i>
            <span class="lm-num">${i}</span>
            <span class="lm-name"></span>`;
        el.addEventListener('click', () => {
            if (el.classList.contains('taken')) return;
            STATE.groupNumber = i;
            document.getElementById('name-screen-num').textContent = i;
            document.getElementById('student-name-input').value = '';
            document.getElementById('btn-confirm-name').disabled = true;
            showScreen('student-name-screen');
            initStudentNameScreen();
        });
        grid.appendChild(el);
    }

    // Real-time: update taken slots
    db.ref(`rooms/${STATE.roomId}/groups`).on('value', snap => {
        const groups = snap.val() || {};
        for (let i = 1; i <= TOTAL_GROUPS; i++) {
            const el = grid.querySelector(`[data-group="${i}"]`);
            if (!el) continue;
            const g = groups[`nhom-${i}`];
            const nameEl = el.querySelector('.lm-name');
            if (g && g.members && g.members.length > 0 && g.online) {
                el.classList.add('taken');
                nameEl.textContent = g.members[0];
            } else {
                el.classList.remove('taken');
                nameEl.textContent = '';
            }
        }
    });
}

/* === 4B. STUDENT NAME SCREEN === */
function initStudentNameScreen() {
    const inp = document.getElementById('student-name-input');
    const btn = document.getElementById('btn-confirm-name');
    inp.focus();

    // Fetch team config — chỉ hiện dropdown tổ + role khi GV BẬT chế độ tổ
    db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value', snap => {
        const tc = snap.val();
        STATE.teamConfig = tc;
        const teamGroup = document.getElementById('team-select-group');
        const roleGroup = document.getElementById('role-select-group');
        if (tc && tc.teams && tc.enabled === true) {
            teamGroup.style.display = '';
            roleGroup.style.display = '';
            const sel = document.getElementById('student-team-select');
            sel.innerHTML = '<option value="">-- Chọn tổ --</option>';
            Object.entries(tc.teams).forEach(([id, t]) => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = t.name;
                opt.style.color = t.color;
                sel.appendChild(opt);
            });
            // Role selector buttons
            document.querySelectorAll('#role-selector .role-btn').forEach(rb => {
                rb.onclick = () => {
                    document.querySelectorAll('#role-selector .role-btn').forEach(b => b.classList.remove('active'));
                    rb.classList.add('active');
                    STATE.teamRole = rb.dataset.role;
                };
            });
            STATE.teamRole = 'member'; // reset
        } else {
            teamGroup.style.display = 'none';
            roleGroup.style.display = 'none';
        }
    });

    const validateForm = () => {
        const nameOk = inp.value.trim().length > 0;
        const tc = STATE.teamConfig;
        if (tc && tc.teams && tc.enabled === true) {
            const teamOk = document.getElementById('student-team-select').value !== '';
            btn.disabled = !(nameOk && teamOk);
        } else {
            btn.disabled = !nameOk;
        }
    };
    inp.oninput = validateForm;
    document.getElementById('student-team-select').onchange = validateForm;
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); };

    document.getElementById('btn-back-to-lobby').onclick = () => {
        STATE.groupNumber = null;
        showScreen('student-lobby');
    };

    btn.onclick = () => {
        const name = inp.value.trim();
        if (!name || !STATE.groupNumber) return;
        const tc = STATE.teamConfig;
        if (tc && tc.teams && tc.enabled === true) {
            const teamSel = document.getElementById('student-team-select').value;
            if (!teamSel) { showToast('Vui lòng chọn tổ!', 'error'); return; }
            STATE.teamId = teamSel;
        }
        loginStudent(name);
    };
}

function loginStudent(name) {
    STATE.role = 'student';
    STATE.studentName = name;
    const gRef = db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}`);
    const groupData = { name: `Nhóm ${STATE.groupNumber}`, members: [name], online: true, score: 0, loginTime: Date.now() };
    // Thêm thông tin tổ nếu có
    if (STATE.teamId) {
        groupData.teamId = STATE.teamId;
        groupData.teamRole = STATE.teamRole || 'member';
    }
    gRef.set(groupData);
    gRef.onDisconnect().update({ online: false });
    // Save session (bao gồm team info)
    safeSetItem('session', JSON.stringify({
        role: 'student', name, group: STATE.groupNumber, room: STATE.roomId,
        teamId: STATE.teamId || null, teamRole: STATE.teamRole || 'member'
    }));

    // [FIX] Global listener: phát hiện GV reset phòng → self-reload
    db.ref(`rooms/${STATE.roomId}/resetAt`).off();
    db.ref(`rooms/${STATE.roomId}/resetAt`).on('value', snap => {
        const resetAt = snap.val();
        if (resetAt && Date.now() - resetAt < 10000) {
            cleanupStudentListeners();
            db.ref(`rooms/${STATE.roomId}/resetAt`).off();
            safeRemoveItem('session');
            showToast('Giáo viên đã reset phòng. Đang tải lại...', 'info');
            setTimeout(() => location.reload(), 1500);
        }
    });

    showScreen('student-home');
    initStudentHome();
    const teamLabel = STATE.teamId ? ` (${STATE.teamConfig?.teams?.[STATE.teamId]?.name || STATE.teamId})` : '';
    showToast(`Chào mừng ${name} — Nhóm ${STATE.groupNumber}${teamLabel}!`, 'success');
}


function loginTeacher() {
    const pw = document.getElementById('teacher-password').value;
    if (pw !== TEACHER_PASSWORD) { showToast('Sai mật khẩu!', 'error'); return; }
    STATE.role = 'teacher';
    safeSetItem('session', JSON.stringify({ role: 'teacher', room: STATE.roomId }));
    db.ref(`rooms/${STATE.roomId}/teacher`).set({ online: true, loginTime: Date.now() });
    db.ref(`rooms/${STATE.roomId}/teacher`).onDisconnect().update({ online: false });
    showScreen('teacher-dashboard');
    initTeacherDashboard();
    showToast('Đăng nhập thành công!', 'success');
}

// Khôi phục session khi máy tắt/refresh
function restoreSession() {
    const s = safeGetItem('session');
    if (!s) return;
    const data = JSON.parse(s);
    STATE.roomId = data.room;
    if (data.role === 'student') {
        STATE.role = 'student'; STATE.studentName = data.name; STATE.groupNumber = data.group;
        STATE.teamId = data.teamId || null; STATE.teamRole = data.teamRole || 'member';
        db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}`).update({ online: true });
        db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}`).onDisconnect().update({ online: false });

        // [FIX] Global listener: phát hiện GV reset phòng → tự xóa session + reload
        db.ref(`rooms/${STATE.roomId}/resetAt`).on('value', snap => {
            const resetAt = snap.val();
            if (resetAt && Date.now() - resetAt < 10000) {
                cleanupStudentListeners();
                db.ref(`rooms/${STATE.roomId}/resetAt`).off();
                safeRemoveItem('session');
                showToast('Giáo viên đã reset phòng. Đang tải lại...', 'info');
                setTimeout(() => location.reload(), 1500);
            }
        });

        // Kiểm tra trạng thái phòng — restore đúng màn hình
        db.ref(`rooms/${STATE.roomId}/status`).once('value', snap => {
            const st = snap.val();
            if (st === 'discussion') { showScreen('discussion-screen'); initDiscussionStudent(); }
            else if (st === 'quiz') { showScreen('quiz-screen'); initQuizStudent(); }
            else if (st === 'homework') { showScreen('homework-screen'); initHomeworkStudent(); }
            else { showScreen('student-home'); initStudentHome(); }
        });
    } else if (data.role === 'teacher') {
        STATE.role = 'teacher';
        db.ref(`rooms/${STATE.roomId}/teacher`).update({ online: true });
        showScreen('teacher-dashboard');
        initTeacherDashboard();
    }
}

/* === 5. STUDENT HOME (replaces waiting-room) === */
function initStudentHome() {
    // Header badge (bao gồm tên tổ nếu có)
    let badgeText = `Nhóm ${STATE.groupNumber} — ${STATE.studentName}`;
    if (STATE.teamId) {
        db.ref(`rooms/${STATE.roomId}/teamConfig/teams/${STATE.teamId}`).once('value', snap => {
            const t = snap.val();
            if (t) {
                const roleIcon = STATE.teamRole === 'leader' ? ' 👑' : '';
                document.getElementById('sh-group-badge').textContent = `${t.name} • Nhóm ${STATE.groupNumber} — ${STATE.studentName}${roleIcon}`;
            }
        });
    }
    document.getElementById('sh-group-badge').textContent = badgeText;

    // Tab switching — dùng event delegation (onclick) để tránh duplicate listeners [BUG 3]
    const shTabsContainer = document.querySelector('.sh-tabs');
    if (shTabsContainer) shTabsContainer.onclick = (e) => {
        const tab = e.target.closest('.sh-tab');
        if (!tab) return;
        document.querySelectorAll('.sh-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sh-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'sh-tab-score') loadStudentScoreTab();
        if (tab.dataset.tab === 'sh-tab-homework') loadHomeworkResultsTab();
    };

    // Logout button
    document.getElementById('btn-student-logout').onclick = () => {
        if (!confirm('Bạn có chắc muốn thoát khỏi lớp học không?')) return;
        cleanupStudentListeners();
        clearInterval(STATE.shStatusInterval);
        db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}`).update({ online: false });
        safeRemoveItem('session');
        STATE.role = null; STATE.studentName = ''; STATE.groupNumber = null;
        showScreen('student-lobby');
        initStudentLobby();
    };

    // [FIX] Gỡ listener cũ trước khi đăng ký mới — tránh listeners bị stack khi quay lại home nhiều lần
    const base = `rooms/${STATE.roomId}`;
    db.ref(`${base}/groups`).off();
    db.ref(`${base}/status`).off();
    db.ref(`${base}/resetAt`).off();

    // [FIX] Lắng nghe signal reset từ GV → tự động logout + reload
    db.ref(`${base}/resetAt`).on('value', snap => {
        const resetAt = snap.val();
        if (resetAt && Date.now() - resetAt < 10000) {
            // GV vừa reset phòng trong 10s gần đây → auto logout + reload
            db.ref(`${base}/groups`).off();
            db.ref(`${base}/status`).off();
            db.ref(`${base}/resetAt`).off();
            clearInterval(STATE.timerInterval);
            safeRemoveItem('session');
            showToast('Giáo viên đã reset phòng. Đang tải lại...', 'info');
            setTimeout(() => location.reload(), 1500);
        }
    });

    // Real-time online bar (dots for all 18 machines)
    db.ref(`rooms/${STATE.roomId}/groups`).on('value', snap => {
        const groups = snap.val() || {};
        const bar = document.getElementById('sh-online-bar');
        let onlineCount = 0;
        let dotsHtml = '<div class="sh-online-title">Tình trạng phòng học</div><div class="sh-dots-row">';
        for (let i = 1; i <= TOTAL_GROUPS; i++) {
            const g = groups[`nhom-${i}`];
            const on = g && g.online;
            if (on) onlineCount++;
            const name = (g && g.members) ? g.members[0] : '';
            dotsHtml += `<div class="sh-machine-dot ${on ? 'online' : ''}" title="${on ? name : 'Chưa có người'}">${i}</div>`;
        }
        dotsHtml += `</div><div class="sh-online-count">Đang online: <strong>${onlineCount}/${TOTAL_GROUPS}</strong> máy</div>`;
        bar.innerHTML = dotsHtml;
    });

    // Listen room status → auto-join activity
    db.ref(`rooms/${STATE.roomId}/status`).on('value', snap => {
        const st = snap.val();
        if (st === 'discussion' || st === 'quiz' || st === 'homework') {
            // [FIX B9] Nếu HS đã ở đúng màn hình activity → chỉ re-init, không hiện overlay
            const currentScreen = document.querySelector('.screen.active')?.id;
            const screenMap = { quiz: 'quiz-screen', discussion: 'discussion-screen', homework: 'homework-screen' };
            const targetScreen = screenMap[st];
            if (currentScreen === targetScreen) return;

            const iconMap = { quiz: '🎯', discussion: '💬', homework: '🏠' };
            const titleMap = { quiz: 'Trắc nghiệm bắt đầu!', discussion: 'Thảo luận bắt đầu!', homework: 'Nhiệm vụ về nhà!' };
            showStudentActivityIncoming(iconMap[st], titleMap[st], () => {
                if (st === 'quiz') { showScreen('quiz-screen'); initQuizStudent(); }
                else if (st === 'homework') { showScreen('homework-screen'); initHomeworkStudent(); }
                else { showScreen('discussion-screen'); initDiscussionStudent(); }
            });
        } else if (st === 'lesson-waiting' || st === 'idle' || st === 'waiting' || !st) {
            // Returned from activity — go back to student-home if on an activity screen
            const currentScreen = document.querySelector('.screen.active')?.id;
            if (currentScreen && currentScreen !== 'student-home' && currentScreen !== 'student-lobby' && currentScreen !== 'student-name-screen') {
                // Clean up homework listeners if coming from homework
                if (currentScreen === 'homework-screen') {
                    db.ref(`rooms/${STATE.roomId}/homeworkState`).off();
                    db.ref(`rooms/${STATE.roomId}/homeworkEvals`).off();
                }
                showScreen('student-home');
                initStudentHome();
                showToast('Hoạt động đã kết thúc! 🏠', 'info');
            }
            // Refresh history (debounced) [BUG 8]
            clearTimeout(STATE.loadHistoryTimeout);
            STATE.loadHistoryTimeout = setTimeout(() => loadStudentHistory(), 500);
        }
    });

    // Load existing history on open
    loadStudentHistory();
}

function showStudentActivityIncoming(icon, title, onGo) {
    const overlay = document.getElementById('sh-activity-incoming');
    document.getElementById('sh-incoming-icon').textContent = icon;
    document.getElementById('sh-incoming-title').textContent = title;
    overlay.style.display = 'flex';
    let cd = 3;
    const cdEl = document.getElementById('sh-incoming-countdown');
    cdEl.textContent = cd;
    clearInterval(STATE.shIncomingInterval);
    STATE.shIncomingInterval = setInterval(() => {
        cd--;
        cdEl.textContent = cd;
        if (cd <= 0) {
            clearInterval(STATE.shIncomingInterval);
            overlay.style.display = 'none';
            onGo();
        }
    }, 1000);
}

function loadStudentHistory() {
    // Load discussion history
    db.ref(`rooms/${STATE.roomId}/discussionAnswers`).once('value', snap => {
        const allAnswers = snap.val() || {};
        const myKey = `nhom-${STATE.groupNumber}`;
        const discEl = document.getElementById('sh-disc-history');
        let html = '';
        Object.entries(allAnswers).forEach(([qId, answers]) => {
            const mine = answers[myKey];
            if (!mine) return;
            html += `<div class="sh-history-card">
                <div class="sh-hc-header">
                    <div class="sh-hc-q"><i class="fas fa-comments" style="color:var(--primary);margin-right:6px;"></i>${mine.questionContent || qId}</div>
                    <span class="sh-badge-disc">Thảo luận</span>
                </div>
                <div class="sh-hc-answer">${mine.answer || '(Chưa trả lời)'}</div>
            </div>`;
        });
        discEl.innerHTML = html || '<p class="empty-state"><i class="fas fa-comments"></i> Chưa có hoạt động thảo luận nào.</p>';
    });

    // Load quiz history
    db.ref(`rooms/${STATE.roomId}/quizAnswers`).once('value', snap => {
        const allAnswers = snap.val() || {};
        const myKey = `nhom-${STATE.groupNumber}`;
        const quizEl = document.getElementById('sh-quiz-history');
        let html = '';
        Object.entries(allAnswers).forEach(([qId, answers]) => {
            const mine = answers[myKey];
            if (!mine) return;
            const badge = mine.isCorrect
                ? '<span class="sh-badge-correct">✅ Đúng</span>'
                : '<span class="sh-badge-wrong">❌ Sai</span>';
            html += `<div class="sh-history-card">
                <div class="sh-hc-header">
                    <div class="sh-hc-q"><i class="fas fa-gamepad" style="color:var(--warning);margin-right:6px;"></i>${mine.questionContent || 'Câu hỏi'}</div>
                    ${badge}
                </div>
                <div class="sh-hc-answer">Đáp án của bạn: <strong>${mine.answer || '—'}</strong></div>
                ${mine.isCorrect ? `<div class="sh-hc-points">+${mine.points || 0} điểm</div>` : ''}
            </div>`;
        });
        quizEl.innerHTML = html || '<p class="empty-state"><i class="fas fa-gamepad"></i> Chưa có hoạt động trắc nghiệm nào.</p>';
    });
}

function loadStudentScoreTab() {
    db.ref(`rooms/${STATE.roomId}/groups`).once('value', snap => {
        const groups = snap.val() || {};
        const sorted = Object.entries(groups)
            .filter(([_, g]) => g.members && g.members.length > 0)
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
        const myKey = `nhom-${STATE.groupNumber}`;
        const myIdx = sorted.findIndex(([k]) => k === myKey);
        const myRank = myIdx >= 0 ? myIdx + 1 : '—';
        const myScore = groups[myKey]?.score || 0;
        const medals = ['🥇', '🥈', '🥉'];
        let html = `<div class="sh-score-header">
            <div class="sh-my-score-num">${myScore}</div>
            <div class="sh-my-rank-label">điểm • Xếp hạng ${myRank}/${sorted.length}</div>
        </div>`;
        sorted.forEach(([key, g], i) => {
            const isMe = key === myKey;
            html += `<div class="sh-history-card" style="${isMe ? 'border-color:rgba(102,126,234,0.5);' : ''}">
                <div class="sh-hc-header">
                    <div class="sh-hc-q">${i < 3 ? medals[i] : (i+1)+'.'}  Nhóm ${key.replace('nhom-','')} — ${g.members?.[0] || ''}</div>
                    <span class="sh-hc-points" style="margin:0;">${g.score || 0} đ</span>
                </div>
            </div>`;
        });
        document.getElementById('sh-score-content').innerHTML = html;
    });
}

/* Keep old initWaitingRoom as no-op for any lingering references */
function initWaitingRoom() { initStudentHome(); }


/* === 6. TEACHER DASHBOARD === */
function initTeacherDashboard() {
    // [FIX B4] Guard: chỉ gắn addEventListener 1 lần duy nhất
    if (window._teacherDashInited) return;
    window._teacherDashInited = true;
    // New td-nav-btn tab switching (new layout)
    document.querySelectorAll('.td-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.td-nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.td-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = document.getElementById(btn.dataset.panel);
            if (panel) panel.classList.add('active');
        });
    });
    // Legacy .menu-item (kept for backward compat)
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', () => showPanel(item.dataset.panel));
    });
    // Inner tabs (Question bank: discussion/quiz/homework)
    document.querySelectorAll('.td-inner-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const parent = tab.closest('.td-split-left') || tab.closest('.td-inner-tabs')?.parentElement;
            parent?.querySelectorAll('.td-inner-tab').forEach(t => t.classList.remove('active'));
            parent?.querySelectorAll('.td-inner-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.subtab);
            if (target) target.classList.add('active');
        });
    });
    // Logout
    document.getElementById('btn-teacher-logout').addEventListener('click', () => {
        safeRemoveItem('session');
        db.ref(`rooms/${STATE.roomId}/teacher`).update({ online: false });
        location.reload();
    });
    // Excel export alias (Results tab stat card)
    const excelAlias = document.getElementById('btn-export-excel-results');
    if (excelAlias) excelAlias.addEventListener('click', () => document.getElementById('btn-export-excel')?.click());
    initOverviewPanel();
    initTeachPanel();
    initQuestionBank();
    initDiscussionTeacher();
    initQuizTeacher();
    initRandomPicker();
    initResetRoom();
    initTimerControls();
    initSoundToggle();
    initSessionHistory();
    initExportExcel();
    initDiscussionRanking();
    initTeamManager();
    initHomeworkTeacher();
    initHomeworkBank();
}

function initOverviewPanel() {
    // Render compact groups bar in Teach tab
    const bar = document.getElementById('teach-groups-bar');
    // [FIX B15] Gỡ listener cũ trước khi gắn mới
    db.ref(`rooms/${STATE.roomId}/groups`).off('value');
    db.ref(`rooms/${STATE.roomId}/groups`).on('value', snap => {
        const groups = snap.val() || {};
        let onlineCount = 0;
        if (bar) {
            bar.innerHTML = '';
            for (let i = 1; i <= TOTAL_GROUPS; i++) {
                const g = groups[`nhom-${i}`];
                const on = g && g.online;
                if (on) onlineCount++;
                const dot = document.createElement('div');
                dot.className = `teach-group-dot ${on ? 'online' : 'offline'}`;
                dot.title = `Nhóm ${i}: ${g && g.members ? g.members[0] : '—'} (${on ? 'Online' : 'Offline'})`;
                dot.textContent = i;
                bar.appendChild(dot);
            }
        } else {
            for (let i = 1; i <= TOTAL_GROUPS; i++) {
                const g = groups[`nhom-${i}`];
                if (g && g.online) onlineCount++;
            }
        }
        document.getElementById('stat-online').textContent = onlineCount;

        // Update persistent header badge
        const headerLabel = document.getElementById('td-online-label');
        if (headerLabel) headerLabel.textContent = `${onlineCount}/${TOTAL_GROUPS} online`;

        // Update teacher-online-badge (in Teach tab, above plan list)
        const badge = document.getElementById('teacher-online-badge');
        if (badge) {
            let dotsHtml = '';
            for (let i = 1; i <= TOTAL_GROUPS; i++) {
                const g = groups[`nhom-${i}`];
                const on = g && g.online;
                const name = on && g.members ? g.members[0] : `Máy ${i}`;
                dotsHtml += `<div class="tob-dot ${on ? 'online' : ''}" title="${name}"></div>`;
            }
            badge.innerHTML = `
                <span class="tob-label"><i class="fas fa-users"></i> Đang online:</span>
                <span class="tob-count">${onlineCount}/${TOTAL_GROUPS}</span>
                <div class="tob-dots">${dotsHtml}</div>`;
        }
    });
    document.getElementById('room-code-display').textContent = `Mã phòng: ${STATE.roomId}`;
}

function initTeachPanel() {
    // Render saved plans in Teach tab for quick activation
    function renderTeachPlanList() {
        db.ref('lessonPlans').once('value', snap => {
            const plans = snap.val() || {};
            const list = document.getElementById('teach-plan-list');
            if (!list) return;
            const keys = Object.keys(plans);
            if (keys.length === 0) {
                list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có kế hoạch. Vào tab Chuẩn bị để tạo.</p>';
                return;
            }
            list.innerHTML = '';
            keys.forEach(k => {
                const p = plans[k];
                const div = document.createElement('div');
                div.className = 'lp-saved-item';
                div.innerHTML = `
                    <div class="lp-saved-info">
                        <span class="lp-saved-title">${p.title}</span>
                        <span class="lp-saved-steps">${p.steps.length} bước</span>
                    </div>
                    <button class="btn-primary" style="width:auto;padding:8px 16px;font-size:13px;" data-plan-id="${k}">
                        <i class="fas fa-play"></i> Kích hoạt
                    </button>`;
                div.querySelector('button').addEventListener('click', () => lpActivatePlan(k));
                list.appendChild(div);
            });
        });
    }
    renderTeachPlanList();
    // Re-render when plans change
    db.ref('lessonPlans').on('value', () => renderTeachPlanList());
    // Listen for active lesson plan → toggle selector vs control area + render cards
    db.ref(`rooms/${STATE.roomId}/lessonPlan`).on('value', snap => {
        const lp = snap.val();
        const selector = document.getElementById('teach-plan-selector');
        const control = document.getElementById('lp-control-area');
        if (lp && lp.isActive) {
            if (selector) selector.style.display = 'none';
            if (control) control.style.display = '';
            // Render activity cards mỗi khi lesson plan thay đổi
            lpRenderActivityCards(lp);
        } else {
            if (selector) selector.style.display = '';
            if (control) control.style.display = 'none';
            showActivityView('hide');
        }
    });
}

/* === 7. QUESTION BANK === */
function initQuestionBank() {
    // Sub-tabs — scoped to parent container
    document.querySelectorAll('.sub-tabs').forEach(tabGroup => {
        tabGroup.querySelectorAll('.sub-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Only toggle siblings within this tab group
                tabGroup.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                // Find matching content within parent panel
                const parent = tabGroup.parentElement;
                const targetId = tab.dataset.subtab;
                // Hide sibling sub-tab-content within the same parent
                const allContent = parent.querySelectorAll(':scope > .sub-tab-content');
                allContent.forEach(c => c.classList.remove('active'));
                const target = document.getElementById(targetId);
                if (target) target.classList.add('active');
            });
        });
    });
    // Time buttons
    document.querySelectorAll('.time-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            STATE.selectedTimeDisc = parseInt(btn.dataset.time);
            // [FIX] Xóa giá trị ô custom khi nhấn nút preset — tránh custom ghi đè
            document.getElementById('disc-custom-time').value = '';
        });
    });
    // [FIX] Khi gõ ô custom → bỏ active khỏi nút preset
    document.getElementById('disc-custom-time').addEventListener('input', () => {
        if (document.getElementById('disc-custom-time').value) {
            document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
        }
    });
    // Quiz type buttons
    document.querySelectorAll('.qtype-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.qtype-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            STATE.selectedQuizType = btn.dataset.type;
            renderQuizOptionsForm(btn.dataset.type);
        });
    });
    renderQuizOptionsForm('multiple-choice');
    // Save discussion question
    document.getElementById('btn-save-disc-question').addEventListener('click', saveDiscQuestion);
    // Save quiz question
    document.getElementById('btn-save-quiz-question').addEventListener('click', saveQuizQuestion);
    // Discussion image upload
    document.getElementById('disc-q-image').addEventListener('change', handleDiscImageSelect);
    document.getElementById('btn-disc-remove-image').addEventListener('click', removeDiscImage);
    // Load saved questions
    loadDiscQuestions();
    loadQuizQuestions();
}

/* --- Discussion Image Handlers --- */
function handleDiscImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Chỉ chọn file hình ảnh!', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { showToast('Hình quá 2MB!', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
        STATE.discImageData = ev.target.result;
        document.getElementById('disc-q-image-preview-img').src = ev.target.result;
        document.getElementById('disc-q-image-preview').style.display = '';
    };
    reader.readAsDataURL(file);
}
function removeDiscImage() {
    STATE.discImageData = null;
    document.getElementById('disc-q-image').value = '';
    document.getElementById('disc-q-image-preview').style.display = 'none';
    document.getElementById('disc-q-image-preview-img').src = '';
}

function saveDiscQuestion() {
    const title = document.getElementById('disc-q-title').value.trim();
    const content = document.getElementById('disc-q-content').value.trim();
    const customTime = document.getElementById('disc-custom-time').value;
    const time = customTime ? parseInt(customTime) : STATE.selectedTimeDisc;
    if (!title || !content) { showToast('Vui lòng nhập đầy đủ!', 'error'); return; }
    // [FIX] Validate thời gian tối thiểu 30 giây
    if (time < 30) { showToast('Thời gian thảo luận tối thiểu 30 giây!', 'error'); return; }
    if (time > 3600) { showToast('Thời gian thảo luận tối đa 60 phút!', 'error'); return; }
    // Nếu đang sửa → update, nếu không → tạo mới
    const isEditing = !!STATE.editingDiscQId;
    const id = STATE.editingDiscQId || db.ref('questionBank/discussion').push().key;
    const qData = { title, content, timeLimit: time, createdAt: Date.now() };
    // Lưu hình ảnh nếu có
    if (STATE.discImageData) qData.imageData = STATE.discImageData;
    db.ref(`questionBank/discussion/${id}`).set(qData);
    document.getElementById('disc-q-title').value = '';
    document.getElementById('disc-q-content').value = '';
    removeDiscImage();
    // Reset trạng thái sửa
    STATE.editingDiscQId = null;
    document.getElementById('btn-save-disc-question').innerHTML = '<i class="fas fa-save"></i> Lưu câu hỏi';
    showToast(isEditing ? 'Đã cập nhật câu hỏi!' : 'Đã lưu câu hỏi thảo luận!', 'success');
}

/* Chỉnh sửa câu hỏi thảo luận */
function editDiscQ(id) {
    db.ref(`questionBank/discussion/${id}`).once('value', snap => {
        const q = snap.val();
        if (!q) return;
        document.getElementById('disc-q-title').value = q.title;
        document.getElementById('disc-q-content').value = q.content;
        STATE.editingDiscQId = id;
        // Load hình ảnh nếu có
        if (q.imageData) {
            STATE.discImageData = q.imageData;
            document.getElementById('disc-q-image-preview-img').src = q.imageData;
            document.getElementById('disc-q-image-preview').style.display = '';
        } else {
            removeDiscImage();
        }
        document.getElementById('btn-save-disc-question').innerHTML = '<i class="fas fa-edit"></i> Cập nhật câu hỏi';
        // Scroll lên form
        document.getElementById('disc-q-title').scrollIntoView({ behavior: 'smooth' });
        document.getElementById('disc-q-title').focus();
        showToast('Đang sửa câu hỏi — chỉnh sửa xong nhấn Cập nhật', 'info');
    });
}

/* [BUG 7] Bộ đếm câu hỏi tổng hợp — tránh lồng .once() trong .on() */
const _qBankCounts = { disc: 0, quiz: 0 };
function _updateQStatCount() {
    const el = document.getElementById('stat-questions');
    if (el) el.textContent = _qBankCounts.disc + _qBankCounts.quiz;
}

function loadDiscQuestions() {
    db.ref('questionBank/discussion').on('value', snap => {
        const qs = snap.val() || {};
        const list = document.getElementById('disc-questions-list');
        const select = document.getElementById('disc-question-select');
        const keys = Object.keys(qs);
        _qBankCounts.disc = keys.length;
        _updateQStatCount();
        if (keys.length === 0) { list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có câu hỏi nào</p>'; select.innerHTML = '<option value="">-- Chọn câu hỏi --</option>'; return; }
        list.innerHTML = '';
        select.innerHTML = '<option value="">-- Chọn câu hỏi --</option>';
        keys.forEach(k => {
            const q = qs[k];
            const hasImage = q.imageData ? '<i class="fas fa-image" style="color:var(--primary);margin-left:6px;" title="Có hình ảnh"></i>' : '';
            const div = document.createElement('div');
            div.className = 'saved-q-item';
            div.innerHTML = `<div class="sq-content"><div class="sq-title">${q.title}${hasImage}</div><div class="sq-meta">⏱ ${formatTime(q.timeLimit)}</div></div><div class="sq-actions"><button class="sq-action-btn edit" onclick="editDiscQ('${k}')"><i class="fas fa-edit"></i></button><button class="sq-action-btn delete" onclick="deleteDiscQ('${k}')"><i class="fas fa-trash"></i></button></div>`;
            list.appendChild(div);
            const opt = document.createElement('option');
            opt.value = k; opt.textContent = q.title + (q.imageData ? ' 🖼️' : '');
            select.appendChild(opt);
        });
    });
}

function deleteDiscQ(id) { db.ref(`questionBank/discussion/${id}`).remove(); showToast('Đã xóa!', 'info'); }

function renderQuizOptionsForm(type) {
    const area = document.getElementById('quiz-options-area');
    if (type === 'multiple-choice') {
        area.innerHTML = `<div class="form-group"><label>Đáp án A</label><input type="text" id="qopt-a" placeholder="Đáp án A"></div>
        <div class="form-group"><label>Đáp án B</label><input type="text" id="qopt-b" placeholder="Đáp án B"></div>
        <div class="form-group"><label>Đáp án C</label><input type="text" id="qopt-c" placeholder="Đáp án C"></div>
        <div class="form-group"><label>Đáp án D</label><input type="text" id="qopt-d" placeholder="Đáp án D"></div>
        <div class="form-group"><label>Đáp án đúng</label><select id="qopt-correct"><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></div>`;
    } else if (type === 'true-false') {
        area.innerHTML = `<div class="form-group"><label>Đáp án đúng</label><select id="qopt-correct"><option value="true">Đúng</option><option value="false">Sai</option></select></div>`;
    } else if (type === 'fill-blank') {
        area.innerHTML = `<div class="form-group"><label>Dùng ___ để đánh dấu chỗ trống trong câu hỏi</label><div class="form-group"><label>Đáp án đúng</label><input type="text" id="qopt-correct" placeholder="Đáp án cho chỗ trống"></div></div>`;
    } else if (type === 'drag-drop') {
        area.innerHTML = `<div class="form-group"><label>Dùng [1], [2], [3]... đánh dấu vị trí thả trong câu hỏi</label></div>
        <div class="form-group"><label>Đáp án theo thứ tự (cách nhau bởi dấu |)</label><input type="text" id="qopt-correct" placeholder="VD: đáp án 1|đáp án 2|đáp án 3"></div>
        <div class="form-group"><label>Thêm đáp án nhiễu (cách nhau bởi |, để trống nếu không có)</label><input type="text" id="qopt-distractors" placeholder="VD: nhiễu 1|nhiễu 2"></div>`;
    } else if (type === 'image-match') {
        area.innerHTML = `
        <div class="im-editor">
            <div class="im-editor-header">
                <span><i class="fas fa-info-circle"></i> Tạo tối đa 6 cặp: ảnh bên trái ghép với nhãn chữ bên phải</span>
                <button type="button" class="btn-secondary" onclick="addImageMatchPair()" style="padding:6px 12px;font-size:12px;">
                    <i class="fas fa-plus"></i> Thêm cặp
                </button>
            </div>
            <div id="im-pairs-list"></div>
        </div>`;
        // Render 3 pairs by default
        window.imPairsCount = 0;
        for (let i = 0; i < 3; i++) addImageMatchPair();
    }
}

function saveQuizQuestion() {
    const content = document.getElementById('quiz-q-content').value.trim();
    const time = parseInt(document.getElementById('quiz-q-time').value) || 30;
    const points = parseInt(document.getElementById('quiz-q-points').value) || 100;
    const type = STATE.selectedQuizType;
    if (!content) { showToast('Vui lòng nhập câu hỏi!', 'error'); return; }
    const data = { content, type, timeLimit: time, points, createdAt: Date.now() };
    if (type === 'multiple-choice') {
        data.options = { A: document.getElementById('qopt-a').value, B: document.getElementById('qopt-b').value, C: document.getElementById('qopt-c').value, D: document.getElementById('qopt-d').value };
        data.correct = document.getElementById('qopt-correct').value;
    } else if (type === 'true-false') {
        data.correct = document.getElementById('qopt-correct').value;
    } else if (type === 'fill-blank') {
        data.correct = document.getElementById('qopt-correct').value;
    } else if (type === 'drag-drop') {
        data.correct = document.getElementById('qopt-correct').value;
        const dist = document.getElementById('qopt-distractors');
        data.distractors = dist ? dist.value : '';
    } else if (type === 'image-match') {
        // Collect all pairs from the form
        const pairRows = document.querySelectorAll('#im-pairs-list .im-pair-row');
        const pairs = [];
        let valid = true;
        pairRows.forEach(row => {
            const label = row.querySelector('.im-label-input').value.trim();
            const imgData = row.querySelector('.im-pair-img').dataset.imgdata || '';
            if (!label) { valid = false; return; }
            pairs.push({ label, imageData: imgData });
        });
        if (!valid || pairs.length < 2) { showToast('Cần ít nhất 2 cặp và nhập đủ nhãn!', 'error'); return; }
        data.pairs = pairs;
        data.correct = pairs.map((_, i) => i).join('|'); // '0|1|2...'
    }
    // Nếu đang sửa → update, nếu không → tạo mới
    if (STATE.editingQuizQId) {
        db.ref(`questionBank/quiz/${STATE.editingQuizQId}`).set(data);
        STATE.editingQuizQId = null;
        document.getElementById('btn-save-quiz-question').innerHTML = '<i class="fas fa-save"></i> Lưu câu hỏi';
        showToast('Đã cập nhật câu hỏi!', 'success');
    } else {
        db.ref('questionBank/quiz').push(data);
        showToast('Đã lưu câu hỏi trắc nghiệm!', 'success');
    }
    document.getElementById('quiz-q-content').value = '';
}

/* Chỉnh sửa câu hỏi trắc nghiệm */
function editQuizQ(id) {
    db.ref(`questionBank/quiz/${id}`).once('value', snap => {
        const q = snap.val();
        if (!q) return;
        // Chọn đúng loại câu hỏi
        STATE.selectedQuizType = q.type;
        document.querySelectorAll('.qtype-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.qtype-btn[data-type="${q.type}"]`).classList.add('active');
        renderQuizOptionsForm(q.type);
        // Điền nội dung
        document.getElementById('quiz-q-content').value = q.content;
        document.getElementById('quiz-q-time').value = q.timeLimit;
        document.getElementById('quiz-q-points').value = q.points;
        // Điền đáp án theo loại
        setTimeout(() => {
            if (q.type === 'multiple-choice' && q.options) {
                document.getElementById('qopt-a').value = q.options.A || '';
                document.getElementById('qopt-b').value = q.options.B || '';
                document.getElementById('qopt-c').value = q.options.C || '';
                document.getElementById('qopt-d').value = q.options.D || '';
                document.getElementById('qopt-correct').value = q.correct;
            } else if (q.type === 'true-false') {
                document.getElementById('qopt-correct').value = q.correct;
            } else if (q.type === 'fill-blank') {
                document.getElementById('qopt-correct').value = q.correct;
            } else if (q.type === 'drag-drop') {
                document.getElementById('qopt-correct').value = q.correct;
                const dist = document.getElementById('qopt-distractors');
                if (dist) dist.value = q.distractors || '';
            } else if (q.type === 'image-match' && q.pairs) {
                // [BUG 12] Khôi phục lại các cặp ảnh-nhãn đã lưu khi sửa câu hỏi
                window.imPairsCount = 0;
                const savedPairs = Array.isArray(q.pairs) ? q.pairs : Object.values(q.pairs);
                savedPairs.forEach(p => addImageMatchPair(p.label || '', p.imageData || ''));
            }
        }, 100);
        STATE.editingQuizQId = id;
        document.getElementById('btn-save-quiz-question').innerHTML = '<i class="fas fa-edit"></i> Cập nhật câu hỏi';
        document.getElementById('quiz-q-content').scrollIntoView({ behavior: 'smooth' });
        document.getElementById('quiz-q-content').focus();
        showToast('Đang sửa câu hỏi — chỉnh sửa xong nhấn Cập nhật', 'info');
    });
}

function loadQuizQuestions() {
    db.ref('questionBank/quiz').on('value', snap => {
        const qs = snap.val() || {};
        const list = document.getElementById('quiz-questions-list');
        const checklist = document.getElementById('quiz-question-checklist');
        const keys = Object.keys(qs);
        _qBankCounts.quiz = keys.length; // [BUG 7] Cập nhật counter riêng
        _updateQStatCount();
        if (keys.length === 0) {
            list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có câu hỏi nào</p>';
            checklist.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có câu hỏi</p>';
            return;
        }
        const typeLabels = { 'multiple-choice': 'Nhiều lựa chọn', 'true-false': 'Đúng/Sai', 'fill-blank': 'Điền khuyết', 'drag-drop': 'Kéo thả', 'image-match': 'Ghép hình' };
        list.innerHTML = ''; checklist.innerHTML = '';
        keys.forEach((k, i) => {
            const q = qs[k];
            list.innerHTML += `<div class="saved-q-item"><div class="sq-content"><div class="sq-title">${i+1}. ${(q.content||'').substring(0,60)}...</div><div class="sq-meta"><span class="qc-type">${typeLabels[q.type]||q.type}</span> ⏱${q.timeLimit}s 🏆${q.points}đ</div></div><div class="sq-actions"><button class="sq-action-btn edit" onclick="editQuizQ('${k}')"><i class="fas fa-edit"></i></button><button class="sq-action-btn delete" onclick="deleteQuizQ('${k}')"><i class="fas fa-trash"></i></button></div></div>`;
            checklist.innerHTML += `<label class="quiz-check-item"><input type="checkbox" value="${k}" onchange="updateQuizSelection()"><span>${i+1}. ${(q.content||'').substring(0,50)}</span><span class="qc-type">${typeLabels[q.type]||q.type}</span></label>`;
        });
    });
}
function deleteQuizQ(id) { db.ref(`questionBank/quiz/${id}`).remove(); showToast('Đã xóa!', 'info'); }

/* === Tạo cặp ảnh-nhãn cho loại câu hỏi image-match === */
function addImageMatchPair(prefillLabel = '', prefillImgData = '') {
    if (!window.imPairsCount) window.imPairsCount = 0;
    if (window.imPairsCount >= 6) { showToast('Tối đa 6 cặp!', 'error'); return; }
    const idx = window.imPairsCount++;
    const list = document.getElementById('im-pairs-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'im-pair-row';
    row.dataset.idx = idx;
    row.innerHTML = `
        <div class="im-pair-num">${idx + 1}</div>
        <div class="im-pair-img-wrap">
            <img class="im-pair-img" data-imgdata="${prefillImgData}" src="${prefillImgData || ''}" style="max-width:90px;max-height:60px;border-radius:6px;${prefillImgData ? '' : 'display:none;'}">
            <label class="im-upload-btn">
                <i class="fas fa-image"></i> Ảnh
                <input type="file" accept="image/*" style="display:none;" onchange="handleImPairImage(this, ${idx})">
            </label>
        </div>
        <input type="text" class="im-label-input" placeholder="Nhãn (VD: Phân đạm)" value="${prefillLabel}" style="flex:1;">
        <button type="button" class="sq-action-btn delete" onclick="this.closest('.im-pair-row').remove(); window.imPairsCount = document.querySelectorAll('.im-pair-row').length;" title="Xóa cặp">
            <i class="fas fa-trash"></i>
        </button>`;
    list.appendChild(row);
}

/* Xử lý upload ảnh cho từng cặp */
function handleImPairImage(input, idx) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Ảnh quá 2MB!', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
        const row = document.querySelector(`.im-pair-row[data-idx="${idx}"]`);
        if (!row) return;
        const img = row.querySelector('.im-pair-img');
        img.src = e.target.result;
        img.dataset.imgdata = e.target.result;
        img.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function updateQuizSelection() {
    const checked = document.querySelectorAll('#quiz-question-checklist input:checked');
    STATE.quizSelectedQuestions = Array.from(checked).map(c => c.value);
    document.getElementById('btn-start-quiz').disabled = STATE.quizSelectedQuestions.length === 0;
}

/* === 8. DISCUSSION MODULE === */
function initDiscussionTeacher() {
    // [FIX B1] Guard: chỉ gắn addEventListener 1 lần duy nhất
    if (window._discTeacherInited) return;
    window._discTeacherInited = true;
    document.getElementById('disc-question-select').addEventListener('change', function() {
        const preview = document.getElementById('disc-question-preview');
        if (!this.value) { preview.style.display = 'none'; return; }
        db.ref(`questionBank/discussion/${this.value}`).once('value', snap => {
            const q = snap.val();
            if (q) { preview.style.display = 'block'; preview.innerHTML = `<strong>${q.title}</strong><br>${q.content}<br><small>⏱ ${formatTime(q.timeLimit)}</small>`; }
        });
    });
    document.getElementById('btn-send-discussion').addEventListener('click', sendDiscussion);
    document.getElementById('btn-stop-discussion').addEventListener('click', stopDiscussion);
    // Compact toggle
    document.getElementById('btn-toggle-compact').addEventListener('click', () => {
        STATE.compactAnswers = !STATE.compactAnswers;
        document.querySelectorAll('#disc-answers-grid .answer-item').forEach(item => {
            item.classList.toggle('compact', STATE.compactAnswers);
            item.classList.remove('expanded');
        });
        const icon = document.querySelector('#btn-toggle-compact i');
        icon.className = STATE.compactAnswers ? 'fas fa-expand-alt' : 'fas fa-compress-alt';
    });
    // Filter
    document.getElementById('disc-answer-filter').addEventListener('change', applyAnswerFilter);
    // Bulk eval
    document.getElementById('btn-bulk-eval').addEventListener('click', submitBulkEval);
    // [FIX B6] Listen answers + evaluations song song, tránh lồng .once() trong .on()
    let _cachedEvals = {};
    db.ref(`rooms/${STATE.roomId}/evaluations`).on('value', snap => {
        _cachedEvals = snap.val() || {};
    });
    db.ref(`rooms/${STATE.roomId}/answers`).on('value', snap => {
        const answers = snap.val() || {};
        const count = Object.keys(answers).length;
        document.getElementById('stat-submitted').textContent = count;
        renderTeacherAnswers(answers, _cachedEvals);
    });
}

function sendDiscussion() {
    const qId = document.getElementById('disc-question-select').value;
    if (!qId) { showToast('Chọn câu hỏi!', 'error'); return; }
    db.ref(`questionBank/discussion/${qId}`).once('value', snap => {
        const q = snap.val();
        showStartStepConfirm(`💬 Thảo luận: ${q.title}`, () => {
            STATE.currentDiscQuestionId = qId;
            const questionData = { id: qId, title: q.title, content: q.content, timeLimit: q.timeLimit, startedAt: Date.now() };
            if (q.imageData) questionData.imageData = q.imageData;
            db.ref(`rooms/${STATE.roomId}`).update({
                status: 'discussion', mode: 'discussion',
                currentQuestion: questionData
            });
            db.ref(`rooms/${STATE.roomId}/timer`).set({
                remaining: q.timeLimit, duration: q.timeLimit, paused: false, startedAt: Date.now()
            });
            db.ref(`rooms/${STATE.roomId}/answers`).remove();
            document.getElementById('btn-send-discussion').style.display = 'none';
            document.getElementById('btn-stop-discussion').style.display = '';
            document.getElementById('disc-answers-area').style.display = '';
            document.getElementById('timer-controls').style.display = '';
            STATE.discussionStopped = false; // [BUG 5] Reset guard trước khi bắt đầu
            startTeacherTimer(q.timeLimit);
            playSound('start');
            showToast('Đã gửi câu hỏi!', 'success');
        });
    });
}

function stopDiscussion() {
    // [BUG 5] Guard: tránh gọi 2 lần đồng thời (timer hết + nút Dừng)
    if (STATE.discussionStopped) return;
    STATE.discussionStopped = true;
    // Dừng timer + reset UI chung
    db.ref(`rooms/${STATE.roomId}/timer`).update({ paused: true, remaining: 0 });
    document.getElementById('btn-stop-discussion').style.display = 'none';
    document.getElementById('btn-send-discussion').style.display = '';
    document.getElementById('timer-controls').style.display = 'none';
    clearInterval(STATE.timerInterval);
    STATE.timerPaused = false;
    document.getElementById('teacher-disc-time').textContent = 'Hết giờ';
    document.getElementById('btn-timer-pause').style.display = '';
    document.getElementById('btn-timer-resume').style.display = 'none';
    playSound('timeup');
    saveSessionHistory('discussion');

    // Kiểm tra: nếu đang trong lesson plan → gọi lpStopStep
    db.ref(`rooms/${STATE.roomId}/lessonStepIndex`).once('value', snap => {
        const stepIdx = snap.val();
        if (stepIdx !== null && stepIdx !== undefined && stepIdx >= 0) {
            lpStopStep(stepIdx);
        } else {
            // Logic gốc cho thảo luận ngoài lesson plan
            db.ref(`rooms/${STATE.roomId}`).update({ status: 'reviewing' });
            showToast('Đã dừng thảo luận!', 'info');
        }
    });
}

function startTeacherTimer(duration) {
    STATE.timerRemaining = duration;
    STATE.timerDuration = duration;
    STATE.timerPaused = false;
    clearInterval(STATE.timerInterval);
    document.getElementById('teacher-disc-time').textContent = formatTime(STATE.timerRemaining);
    STATE.timerInterval = setInterval(() => {
        if (STATE.timerPaused) return;
        STATE.timerRemaining--;
        document.getElementById('teacher-disc-time').textContent = formatTime(STATE.timerRemaining);
        // Đồng bộ timer lên Firebase mỗi 5 giây
        if (STATE.timerRemaining % 5 === 0) {
            db.ref(`rooms/${STATE.roomId}/timer`).update({ remaining: STATE.timerRemaining });
        }
        // Cảnh báo 10 giây cuối
        if (STATE.timerRemaining === 10) playSound('warning');
        if (STATE.timerRemaining <= 0) { clearInterval(STATE.timerInterval); stopDiscussion(); }
    }, 1000);
}

// [FIX B6] Nhận evals đã cache từ listener song song, không gọi .once() bên trong
function renderTeacherAnswers(answers, evals) {
    evals = evals || {};
    const grid = document.getElementById('disc-answers-grid');
    const count = Object.keys(answers).length;
    // Cập nhật progress
    document.getElementById('disc-submit-progress').textContent = `${count}/${TOTAL_GROUPS} đã nộp`;

    grid.innerHTML = '';

    Object.keys(answers).forEach(gName => {
        const a = answers[gName];
        const isEvaluated = evals[gName] ? true : false;
        let filesHtml = '';
        if (a.files) {
            a.files.forEach((f, fi) => {
                // Dùng _fileCache để tránh đưa base64 vào onclick attribute
                const cacheKey = `teacher_${gName}_${fi}`;
                window._fileCache[cacheKey] = f;
                const icon = (f.type||'').startsWith('image/') ? 'fa-file-image' : f.type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-alt';
                filesHtml += `<span class="file-tag clickable" title="Click để xem trước" onclick="event.stopPropagation();const _f=window._fileCache['${cacheKey}'];if(_f)showFilePreview(_f.data,_f.name,_f.type)"><i class="fas ${icon}"></i> ${f.name}</span>`;
            });
        }
        grid.innerHTML += `<div class="answer-item ${STATE.compactAnswers ? 'compact' : ''}" data-group="${gName}" data-evaluated="${isEvaluated}" onclick="toggleAnswerExpand(this)">
            <div class="ai-header"><span class="ai-group">${gName}</span><span class="ai-time">${a.submittedAt ? new Date(a.submittedAt).toLocaleTimeString('vi') : ''}</span>${isEvaluated ? '<span class="ai-eval-badge">✅</span>' : ''}</div>
            <div class="ai-content">${formatAnswerContent(a.content)}</div>
            ${filesHtml ? `<div class="ai-files">${filesHtml}</div>` : ''}
            <div class="ai-reactions" data-group="${gName}" style="display:none;"></div>
            <div class="eval-section">
                <div class="star-rating" id="stars-${gName}">${[1,2,3,4,5].map(s => `<span class="star" data-star="${s}" onclick="event.stopPropagation();rateStar('${gName}',${s})">★</span>`).join('')}</div>
                <div class="eval-comment"><textarea id="eval-comment-${gName}" placeholder="Nhận xét..." rows="2" onclick="event.stopPropagation()"></textarea></div>
                <button class="btn-eval" onclick="event.stopPropagation();submitEval('${gName}')"><i class="fas fa-check"></i> Đánh giá</button>
            </div></div>`;
    });

    // Render math formulas in answers
    renderMathContent(grid);
    // Hiện phần phân tích khi có ≥2 câu trả lời
    if (count >= 2) {
        document.getElementById('disc-answer-summary').style.display = '';
        renderAnswerClusters(answers);
    }
    // Cập nhật hiển thị reactions (có thể đã có reactions trước đó từ HS)
    updateTeacherReactionDisplay();
    // Áp dụng filter hiện tại
    applyAnswerFilter();
}

function toggleAnswerExpand(el) {
    if (el.classList.contains('compact')) {
        el.classList.remove('compact');
        el.classList.add('expanded');
    } else if (el.classList.contains('expanded')) {
        el.classList.remove('expanded');
    }
}

function applyAnswerFilter() {
    const filter = document.getElementById('disc-answer-filter').value;
    document.querySelectorAll('#disc-answers-grid .answer-item').forEach(item => {
        const isEvaluated = item.dataset.evaluated === 'true';
        if (filter === 'all') item.style.display = '';
        else if (filter === 'evaluated') item.style.display = isEvaluated ? '' : 'none';
        else item.style.display = isEvaluated ? 'none' : '';
    });
}

/* Phân tích nhóm câu trả lời tương tự */
function renderAnswerClusters(answers) {
    const stopWords = new Set(['là','và','của','có','cho','các','được','với','trong','này','đó','một','những','không','từ','để','đã','sẽ','đến','theo','về','tại','hay','như','khi','nếu','mà','do','vì','nên','thì','cũng','rất','bị','hơn','nhưng','hoặc']);
    const answerEntries = Object.entries(answers).filter(([,a]) => a.content && a.content.trim());

    // Trích xuất từ khóa cho mỗi nhóm
    const groupKeywords = answerEntries.map(([g, a]) => {
        const words = a.content.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));
        return { group: g, words: new Set(words), content: a.content };
    });

    // Tìm từ khóa phổ biến nhất
    const wordCounts = {};
    groupKeywords.forEach(gk => gk.words.forEach(w => { wordCounts[w] = (wordCounts[w] || 0) + 1; }));
    const popularWords = Object.entries(wordCounts).filter(([,c]) => c >= 2).sort((a,b) => b[1]-a[1]).slice(0, 8);

    const clustersEl = document.getElementById('disc-answer-clusters');
    if (popularWords.length === 0) {
        clustersEl.innerHTML = '<p class="empty-state"><i class="fas fa-search"></i> Các câu trả lời khá khác nhau</p>';
        return;
    }

    let html = '<div class="clusters-grid">';
    popularWords.forEach(([word, count]) => {
        const matchGroups = groupKeywords.filter(gk => gk.words.has(word)).map(gk => gk.group);
        html += `<div class="cluster-item">
            <span class="cluster-keyword">${word}</span>
            <span class="cluster-count">${count} nhóm</span>
            <div class="cluster-groups">${matchGroups.map(g => `<span class="cluster-group-tag">${g}</span>`).join('')}</div>
        </div>`;
    });
    html += '</div>';
    clustersEl.innerHTML = html;
}

function rateStar(group, star) {
    const stars = document.querySelectorAll(`#stars-${group} .star`);
    stars.forEach((s, i) => { s.classList.toggle('filled', i < star); });
    document.getElementById(`stars-${group}`).dataset.rating = star;
}

function submitEval(group) {
    const starsEl = document.getElementById(`stars-${group}`);
    const score = parseInt(starsEl.dataset.rating) || 0;
    const comment = document.getElementById(`eval-comment-${group}`).value;
    db.ref(`rooms/${STATE.roomId}/evaluations/${group}`).set({ stars: score, comment, evaluatedBy: 'teacher', timestamp: Date.now() });
    // Đánh dấu đã đánh giá trên UI
    const item = document.querySelector(`.answer-item[data-group="${group}"]`);
    if (item) { item.dataset.evaluated = 'true'; }
    showToast(`Đã đánh giá ${group}!`, 'success');
}

/* Nhận xét chung cho tất cả nhóm */
function rateBulkStar(star) {
    const stars = document.querySelectorAll('#bulk-eval-stars .star');
    stars.forEach((s, i) => { s.classList.toggle('filled', i < star); });
    document.getElementById('bulk-eval-stars').dataset.rating = star;
}

function submitBulkEval() {
    const starsEl = document.getElementById('bulk-eval-stars');
    const score = parseInt(starsEl.dataset.rating) || 0;
    const comment = document.getElementById('bulk-eval-comment').value;
    if (!comment && score === 0) { showToast('Nhập nhận xét hoặc chọn sao!', 'error'); return; }
    // Gửi cho tất cả nhóm đã nộp bài
    db.ref(`rooms/${STATE.roomId}/answers`).once('value', snap => {
        const answers = snap.val() || {};
        const updates = {};
        Object.keys(answers).forEach(gName => {
            updates[`${gName}`] = { stars: score, comment: `[Nhận xét chung] ${comment}`, evaluatedBy: 'teacher', timestamp: Date.now() };
        });
        db.ref(`rooms/${STATE.roomId}/evaluations`).update(updates);
        showToast(`Đã gửi nhận xét chung cho ${Object.keys(answers).length} nhóm!`, 'success');
        document.getElementById('bulk-eval-comment').value = '';
    });
}


/* === FILE PREVIEW MODAL === */
// viewFile — giờ đội vào modal thay vì mở tab mới
function viewFile(dataUrl, name, type) {
    showFilePreview(dataUrl, name, type);
}

window._fileCache = {}; // Lưu file data khỏi phải đưa thẳng vào onclick

function showFilePreview(dataUrl, name, type) {
    const modal = document.getElementById('file-preview-modal');
    if (!modal) return;
    document.getElementById('fpm-title-text').textContent = name;
    const dlBtn = document.getElementById('fpm-download-btn');
    dlBtn.href = dataUrl;
    dlBtn.download = name;
    const body = document.getElementById('fpm-body');
    body.innerHTML = '';
    if (type && type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = dataUrl; img.alt = name; img.className = 'fpm-preview-img';
        img.title = 'Click để phóng to / thu nhỏ';
        img.onclick = () => img.classList.toggle('fpm-zoomed');
        body.appendChild(img);
    } else if (type === 'application/pdf') {
        body.innerHTML = `<embed src="${dataUrl}" type="application/pdf" class="fpm-preview-pdf">`;
    } else {
        const ext = (name.split('.').pop() || '').toUpperCase();
        const iconMap = { DOCX:'fa-file-word', DOC:'fa-file-word', XLSX:'fa-file-excel', XLS:'fa-file-excel', TXT:'fa-file-alt' };
        const colorMap = { DOCX:'#2b579a', DOC:'#2b579a', XLSX:'#217346', XLS:'#217346', PDF:'#e44141' };
        body.innerHTML = `<div class="fpm-no-preview">
            <i class="fas ${iconMap[ext]||'fa-file-alt'}" style="color:${colorMap[ext]||'var(--primary)'};font-size:64px;"></i>
            <div class="fpm-file-name">${name}</div>
            <div class="fpm-file-type">${ext} file</div>
            <div class="fpm-file-hint"><i class="fas fa-info-circle"></i> Nhấn "Tải xuống" để mở file</div>
        </div>`;
    }
    modal.style.display = 'flex';
    modal._esc = (e) => { if (e.key === 'Escape') closeFilePreview(); };
    document.addEventListener('keydown', modal._esc);
}

window.closeFilePreview = function() {
    const modal = document.getElementById('file-preview-modal');
    if (!modal) return;
    modal.style.display = 'none';
    if (modal._esc) { document.removeEventListener('keydown', modal._esc); modal._esc = null; }
};

/* === REACTIONS SYSTEM === */
window.sendReaction = function(toGroup, type) {
    if (!STATE.groupNumber) return;
    const fromGroup = `nhom-${STATE.groupNumber}`;
    if (fromGroup === toGroup) return; // không react bài mình
    const ref = db.ref(`rooms/${STATE.roomId}/reactions/${toGroup}/${fromGroup}/${type}`);
    ref.once('value').then(snap => {
        if (snap.val()) ref.remove(); else ref.set(true); // toggle
    });
};

function initReactionListener() {
    const reactionRef = db.ref(`rooms/${STATE.roomId}/reactions`);
    reactionRef.off();
    reactionRef.on('value', snap => {
        const all = snap.val() || {};
        const myGroup = `nhom-${STATE.groupNumber}`;
        Object.keys(all).forEach(toGroup => {
            const reactData = all[toGroup] || {};
            const counts = { like:0, heart:0, fire:0 };
            const myReacts = reactData[myGroup] || {};
            Object.values(reactData).forEach(r => {
                if (r.like) counts.like++;
                if (r.heart) counts.heart++;
                if (r.fire) counts.fire++;
            });
            const bar = document.querySelector(`.reaction-bar[data-group="${toGroup}"]`);
            if (!bar) return;
            ['like','heart','fire'].forEach(t => {
                const btn = bar.querySelector(`.reaction-btn[data-type="${t}"]`);
                if (!btn) return;
                btn.classList.toggle('reacted', !!myReacts[t]);
                const cEl = btn.querySelector('.reaction-count');
                if (cEl) cEl.textContent = counts[t] > 0 ? counts[t] : '';
            });
        });
    });
}

function updateTeacherReactionDisplay() {
    db.ref(`rooms/${STATE.roomId}/reactions`).once('value').then(snap => {
        const all = snap.val() || {};
        Object.keys(all).forEach(toGroup => {
            const counts = { like:0, heart:0, fire:0 };
            Object.values(all[toGroup] || {}).forEach(r => {
                if (r.like) counts.like++;
                if (r.heart) counts.heart++;
                if (r.fire) counts.fire++;
            });
            const el = document.querySelector(`.ai-reactions[data-group="${toGroup}"]`);
            if (!el) return;
            const total = counts.like + counts.heart + counts.fire;
            if (total > 0) {
                el.innerHTML = `<span class="ai-react-item">👍 ${counts.like}</span><span class="ai-react-item">❤️ ${counts.heart}</span><span class="ai-react-item">🔥 ${counts.fire}</span>`;
                el.style.display = 'flex';
            } else { el.style.display = 'none'; }
        });
    });
}

/* === 9. DISCUSSION STUDENT === */
function initDiscussionStudent() {
    // [BUG 4] Gỡ mọi listener cũ trước khi gắn mới — tránh duplicate khi vào lại activity
    const _dbase = `rooms/${STATE.roomId}`;
    db.ref(`${_dbase}/currentQuestion`).off();
    db.ref(`${_dbase}/timer`).off();
    db.ref(`${_dbase}/status`).off();
    db.ref(`${_dbase}/answers`).off();
    db.ref(`${_dbase}/peerReviews`).off();
    db.ref(`${_dbase}/evaluations/nhom-${STATE.groupNumber}`).off();

    const topGroup = document.getElementById('disc-student-group');
    const topName = document.getElementById('disc-student-name');
    topGroup.textContent = `Nhóm ${STATE.groupNumber}`;
    topName.textContent = STATE.studentName;
    // Lắng nghe câu hỏi
    db.ref(`rooms/${STATE.roomId}/currentQuestion`).on('value', snap => {
        const q = snap.val();
        if (q) {
            const draftKey = `disc_draft_${STATE.roomId}_${q.id || 'q'}_nhom${STATE.groupNumber}`;
            // Reset form cho câu hỏi mới
            document.getElementById('disc-answer-input').value = '';
            document.getElementById('disc-answer-input').disabled = false;
            document.getElementById('btn-submit-answer').style.display = '';
            document.getElementById('btn-submit-answer').disabled = false;
            document.getElementById('disc-submitted-badge').style.display = 'none';
            document.getElementById('disc-file-preview').innerHTML = '';
            STATE.attachedFiles = [];
            // Ẩn peer review + evaluation từ câu hỏi trước
            document.getElementById('peer-review-area').style.display = 'none';
            document.getElementById('evaluation-area').style.display = 'none';
            // Ẩn math preview
            const previewEl = document.getElementById('math-preview');
            if (previewEl) previewEl.style.display = 'none';

            document.getElementById('disc-question-display').innerHTML = `<strong>${q.title || ''}</strong><br>${q.content}`;
            // Hiển hình ảnh nếu có
            const imgContainer = document.getElementById('disc-question-image');
            const imgEl = document.getElementById('disc-question-image-img');
            if (q.imageData) {
                imgEl.src = q.imageData;
                imgContainer.style.display = '';
            } else {
                imgContainer.style.display = 'none';
                imgEl.src = '';
            }
            playSound('newQuestion');

            // Kiểm tra nếu HS đã gửi câu trả lời cho câu hỏi này
            db.ref(`rooms/${STATE.roomId}/answers/nhom-${STATE.groupNumber}`).once('value', aSnap => {
                const a = aSnap.val();
                if (a && a.status === 'submitted') {
                    document.getElementById('disc-answer-input').value = a.content || '';
                    document.getElementById('btn-submit-answer').style.display = 'none';
                    document.getElementById('disc-submitted-badge').style.display = '';
                    safeRemoveItem(draftKey); // Clear draft if already submitted
                } else {
                    // Restore draft from localStorage if exists (F5 persistence)
                    const draft = safeGetItem(draftKey);
                    if (draft) {
                        document.getElementById('disc-answer-input').value = draft;
                        showToast('Đã khôi phục nội dung đang soạn 📝', 'info');
                    }
                }
            });

            // Auto-save draft on every input
            const ta = document.getElementById('disc-answer-input');
            ta.oninput = () => safeSetItem(draftKey, ta.value);

            // Store question ID and content for history display (used in submitStudentAnswer)
            STATE.currentDiscDraftKey = draftKey;
            STATE.currentDiscQuestionId = q.id || 'q';
        }
    });
    // [FIX B11] Lắng nghe timer từ Firebase — dùng remaining + Date.now() khi resume
    db.ref(`rooms/${STATE.roomId}/timer`).on('value', snap => {
        const t = snap.val();
        if (!t) return;
        STATE.timerRemaining = t.remaining;
        STATE.timerDuration = t.duration;
        if (t.paused) {
            clearInterval(STATE.timerInterval);
            document.getElementById('disc-countdown-text').textContent = formatTime(t.remaining);
        } else {
            // Khi GV resume sau pause/extend, dùng remaining + startedAt mới để đồng bộ chính xác
            startStudentTimer(t.remaining, t.startedAt);
        }
    });
    // [FIX B3] Dùng .onclick ghi đè thay vì addEventListener để tránh listener trùng
    document.getElementById('disc-file-input').onchange = handleFileSelect;
    // Submit answer
    document.getElementById('btn-submit-answer').onclick = submitStudentAnswer;
    // Math toolbar — dùng event delegation thay vì gắn từng nút
    const mathToolbar = document.getElementById('math-toolbar');
    mathToolbar.onclick = (e) => {
        const btn = e.target.closest('.math-btn');
        if (!btn) return;
        const textarea = document.getElementById('disc-answer-input');
        const text = btn.dataset.insert;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
        updateMathPreview();
    };
    // Alt+Enter for newline + live preview — dùng .onkeydown / .oninput (ghi đè)
    const answerInput = document.getElementById('disc-answer-input');
    answerInput.onkeydown = function(e) {
        if (e.altKey && e.key === 'Enter') {
            e.preventDefault();
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = this.value.substring(0, start) + '\n' + this.value.substring(end);
            this.selectionStart = this.selectionEnd = start + 1;
            updateMathPreview();
        }
    };
    // Kết hợp oninput: auto-save draft + math preview (gán 1 lần, ghi đè mỗi init)
    // (auto-save draft đã gán ở trên trong currentQuestion listener)
    const existingOnInput = answerInput.oninput;
    answerInput.oninput = function() {
        if (typeof existingOnInput === 'function') existingOnInput.call(this);
        updateMathPreview();
    };
    // Logout (discussion screen has its own button with ID btn-disc-logout)
    document.getElementById('btn-disc-logout').onclick = () => {
        cleanupStudentListeners();
        safeRemoveItem('session');
        db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}`).update({ online: false });
        location.reload();
    };
    // Lắng nghe trạng thái reviewing → hiện peer review; idle → quay về trang chủ
    db.ref(`rooms/${STATE.roomId}/status`).on('value', snap => {
        const st = snap.val();
        if (st === 'reviewing') {
            document.getElementById('peer-review-area').style.display = '';
            loadPeerAnswers();
            loadEvaluation();
        } else if (st === 'idle' || st === 'waiting' || st === 'lesson-waiting' || !st) {
            // Giáo viên kết thúc hoạt động → học sinh quay về trang chủ
            clearInterval(STATE.timerInterval);
            db.ref(`rooms/${STATE.roomId}/status`).off();
            db.ref(`rooms/${STATE.roomId}/currentQuestion`).off();
            db.ref(`rooms/${STATE.roomId}/timer`).off();
            showScreen('student-home');
            initStudentHome();
            showToast('Hoạt động kết thúc. Chào mừng trở lại! 🏠', 'info');
        }
    });
}

function startStudentTimer(duration, startedAt) {
    clearInterval(STATE.timerInterval);
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    let remaining = Math.max(0, duration - elapsed);
    const circle = document.getElementById('disc-countdown-circle');
    const text = document.getElementById('disc-countdown-text');
    const circumference = 2 * Math.PI * 45;
    circle.style.strokeDasharray = circumference;
    const updateTimer = () => {
        text.textContent = formatTime(remaining);
        const pct = remaining / duration;
        circle.style.strokeDashoffset = circumference * (1 - pct);
        circle.style.stroke = pct < 0.2 ? 'var(--danger)' : 'var(--success)';
        if (remaining <= 0) {
            clearInterval(STATE.timerInterval);
            text.textContent = 'Hết giờ!';
            document.getElementById('disc-answer-input').disabled = true;
            document.getElementById('btn-submit-answer').disabled = true;
        }
        remaining--;
    };
    updateTimer();
    STATE.timerInterval = setInterval(updateTimer, 1000);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    const preview = document.getElementById('disc-file-preview');
    files.forEach(file => {
        if (file.size > 2 * 1024 * 1024) { showToast(`${file.name} quá 2MB!`, 'error'); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const fileData = { name: file.name, type: file.type, data: ev.target.result };
            STATE.attachedFiles.push(fileData);
            // [FIX B13] Dùng unique ID thay vì index để xóa đúng file
            const fileUid = 'f_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const cacheKey = `own_${fileUid}`;
            window._fileCache = window._fileCache || {};
            window._fileCache[cacheKey] = fileData;
            const tag = document.createElement('div');
            tag.className = 'file-preview-item';
            tag.dataset.fileUid = fileUid;
            const icon = file.type.startsWith('image/') ? 'fa-file-image' : file.type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-alt';
            tag.innerHTML = `
                <span class="file-tag clickable" title="Click để xem trước" onclick="const f=window._fileCache['${cacheKey}'];if(f)showFilePreview(f.data,f.name,f.type)">
                    <i class="fas ${icon}"></i> ${file.name}
                </span>
                <span class="remove-file" onclick="removeAttachedFile(this.parentElement, '${cacheKey}')">&times;</span>`;
            preview.appendChild(tag);
        };
        reader.readAsDataURL(file);
    });
}

// [FIX B13] Hàm xóa file đính kèm — dùng filter thay splice để tránh index lệch
function removeAttachedFile(tagEl, cacheKey) {
    const fileData = window._fileCache[cacheKey];
    if (fileData) {
        STATE.attachedFiles = STATE.attachedFiles.filter(f => f !== fileData);
        delete window._fileCache[cacheKey];
    }
    tagEl.remove();
}

/* === MATH RENDERING UTILITIES === */
function updateMathPreview() {
    const text = document.getElementById('disc-answer-input').value;
    const previewEl = document.getElementById('math-preview');
    const contentEl = document.getElementById('math-preview-content');
    if (!text.includes('$')) {
        previewEl.style.display = 'none';
        return;
    }
    previewEl.style.display = '';
    // Convert newlines to <br> and escape HTML
    const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g, '<br>');
    contentEl.innerHTML = escaped;
    renderMathContent(contentEl);
}

function renderMathContent(element, retries = 0) {
    if (typeof renderMathInElement === 'function') {
        try {
            renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        } catch(e) { /* throwOnError:false nên không nên xảy ra */ }
    } else if (retries < 10) {
        // KaTeX defer chưa load xong → thử lại sau 150ms
        setTimeout(() => renderMathContent(element, retries + 1), 150);
    }
}

// Render math in content string → returns HTML string (math rendered later via renderMathContent on DOM)
function formatAnswerContent(text) {
    if (!text) return '';
    // Escape HTML, giữ nguyên $ delimiters để KaTeX render trong DOM
    return text
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/\n/g, '<br>');
}

function submitStudentAnswer() {
    const content = document.getElementById('disc-answer-input').value.trim();
    if (!content && STATE.attachedFiles.length === 0) { showToast('Vui lòng nhập câu trả lời!', 'error'); return; }
    const answerData = { content, status: 'submitted', submittedAt: Date.now(), submittedBy: STATE.studentName };
    if (STATE.attachedFiles.length > 0) answerData.files = STATE.attachedFiles;
    // Save to answers (for real-time teacher view)
    db.ref(`rooms/${STATE.roomId}/answers/nhom-${STATE.groupNumber}`).set(answerData);
    // ALSO save to discussionAnswers (for student history tab) with question content
    const qId = STATE.currentDiscQuestionId || 'unknown';
    db.ref(`rooms/${STATE.roomId}/currentQuestion`).once('value', qSnap => {
        const q = qSnap.val();
        const historyEntry = {
            answer: content,
            questionContent: q ? `${q.title || ''} — ${q.content || ''}` : qId,
            submittedAt: Date.now(),
            submittedBy: STATE.studentName
        };
        db.ref(`rooms/${STATE.roomId}/discussionAnswers/${qId}/nhom-${STATE.groupNumber}`).set(historyEntry);
    });
    // Clear draft after successful submit
    if (STATE.currentDiscDraftKey) safeRemoveItem(STATE.currentDiscDraftKey);
    document.getElementById('btn-submit-answer').style.display = 'none';
    document.getElementById('disc-submitted-badge').style.display = '';
    showToast('Đã gửi câu trả lời!', 'success');
    // Ngay sau khi gửi → hiện câu trả lời các nhóm khác + nhận xét
    document.getElementById('peer-review-area').style.display = '';
    loadPeerAnswers();
    loadEvaluation();
}

function loadPeerAnswers() {
    db.ref(`rooms/${STATE.roomId}/answers`).on('value', snap => {
        const answers = snap.val() || {};
        window._fileCache = {}; // reset cache file xem trước
        const list = document.getElementById('peer-answers-list');
        list.innerHTML = '';

        // Nhóm mình (không có reaction bar)
        const myAnswer = answers[`nhom-${STATE.groupNumber}`];
        if (myAnswer) {
            const myCard = document.createElement('div');
            myCard.className = 'peer-answer-card';
            myCard.style.borderColor = 'var(--primary)';
            myCard.innerHTML = `<div class="pa-group" style="color:var(--success)">📝 Nhóm ${STATE.groupNumber} (Nhóm bạn)</div><div class="pa-content">${myAnswer.content || ''}</div>`;
            list.appendChild(myCard);
        }

        // Các nhóm khác — có reaction bar + file preview
        Object.keys(answers).forEach(gName => {
            if (gName === `nhom-${STATE.groupNumber}`) return;
            const a = answers[gName];
            const card = document.createElement('div');
            card.className = 'peer-answer-card';
            card.dataset.group = gName;

            // File tags với preview
            let filesHtml = '';
            if (a.files) {
                a.files.forEach((f, fi) => {
                    const cacheKey = `${gName}_${fi}`;
                    window._fileCache[cacheKey] = f;
                    const icon = (f.type||'').startsWith('image/') ? 'fa-file-image' : f.type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-alt';
                    filesHtml += `<span class="file-tag clickable" title="Click để xem trước" onclick="const f=window._fileCache['${cacheKey}'];if(f)showFilePreview(f.data,f.name,f.type)"><i class="fas ${icon}"></i> ${f.name}</span>`;
                });
            }

            // Reaction bar
            const reactionBar = `<div class="reaction-bar" data-group="${gName}">
                <button class="reaction-btn" data-type="like" onclick="sendReaction('${gName}','like')">👍 <span class="reaction-count"></span></button>
                <button class="reaction-btn heart-btn" data-type="heart" onclick="sendReaction('${gName}','heart')">❤️ <span class="reaction-count"></span></button>
                <button class="reaction-btn fire-btn" data-type="fire" onclick="sendReaction('${gName}','fire')">🔥 <span class="reaction-count"></span></button>
            </div>`;

            card.innerHTML = `<div class="pa-group">${gName}</div>
                <div class="pa-content">${a.content || ''}</div>
                ${filesHtml ? `<div class="ai-files" style="margin-top:8px">${filesHtml}</div>` : ''}
                ${reactionBar}
                <div class="peer-comment-area">
                    <input class="peer-comment-input" id="pc-input-${gName}" placeholder="Nhận xét nhóm này...">
                    <button class="btn-peer-comment" onclick="sendPeerComment('${gName}')">Gửi nhận xét</button>
                    <div class="peer-comments-list" id="pc-list-${gName}"></div>
                </div>`;
            list.appendChild(card);
        });
        loadPeerComments();
        initReactionListener(); // Bắt đầu lắng nghe reactions real-time
    });
}

function sendPeerComment(toGroup) {
    const input = document.getElementById(`pc-input-${toGroup}`);
    const comment = input.value.trim();
    if (!comment) return;
    db.ref(`rooms/${STATE.roomId}/peerReviews`).push({
        fromGroup: `nhom-${STATE.groupNumber}`, toGroup, comment, timestamp: Date.now()
    });
    input.value = '';
    showToast('Đã gửi nhận xét!', 'success');
}

function loadPeerComments() {
    // [BUG 14] Gỡ listener cũ trước khi gắn mới — tránh exponential listener growth
    db.ref(`rooms/${STATE.roomId}/peerReviews`).off();
    db.ref(`rooms/${STATE.roomId}/peerReviews`).on('value', snap => {
        const reviews = snap.val() || {};
        // Clear all
        document.querySelectorAll('.peer-comments-list').forEach(el => el.innerHTML = '');
        Object.values(reviews).forEach(r => {
            const el = document.getElementById(`pc-list-${r.toGroup}`);
            if (el) { el.innerHTML += `<div class="peer-comment-item"><span class="pc-from">${r.fromGroup}:</span> ${r.comment}</div>`; }
        });
    });
}

function loadEvaluation() {
    db.ref(`rooms/${STATE.roomId}/evaluations/nhom-${STATE.groupNumber}`).on('value', snap => {
        const ev = snap.val();
        const area = document.getElementById('evaluation-area');
        const content = document.getElementById('evaluation-content');
        if (ev) {
            area.style.display = '';
            content.innerHTML = `<div class="eval-stars">${'★'.repeat(ev.stars)}${'☆'.repeat(5 - ev.stars)}</div><div class="eval-text">${ev.comment || 'Không có nhận xét'}</div>`;
        }
    });
}

/* === 10. QUIZ MODULE - TEACHER === */
function initQuizTeacher() {
    // [FIX B2] Guard: chỉ gắn addEventListener 1 lần duy nhất
    if (window._quizTeacherInited) return;
    window._quizTeacherInited = true;
    document.getElementById('btn-start-quiz').addEventListener('click', startQuiz);
    document.getElementById('btn-quiz-next').addEventListener('click', nextQuizQuestion);
    document.getElementById('btn-quiz-end').addEventListener('click', endQuiz);
    // Button to manually skip timer and show answer
    document.getElementById('btn-quiz-show-answer').addEventListener('click', () => {
        clearInterval(STATE.timerInterval);
        showQuizAnswer(STATE.quizCurrentIndex);
    });
}

function startQuiz() {
    if (STATE.quizSelectedQuestions.length === 0) return;
    STATE.quizCurrentIndex = 0;
    // Reset rank tracking for shuffle animation
    STATE._prevTeacherRanking = {};
    STATE._prevTeacherScores = {};
    STATE._prevStudentRanking = {};
    STATE._prevStudentScores = {};
    const promises = STATE.quizSelectedQuestions.map(id => db.ref(`questionBank/quiz/${id}`).once('value'));
    Promise.all(promises).then(snaps => {
        STATE.quizQuestionsData = snaps.map((s, i) => ({ id: STATE.quizSelectedQuestions[i], ...s.val() }));
        // Hiện overlay xác nhận + online status + countdown 3-2-1
        showStartStepConfirm(`🎯 Trắc nghiệm (${STATE.quizQuestionsData.length} câu)`, () => {
            db.ref(`rooms/${STATE.roomId}`).update({ status: 'quiz', mode: 'quiz' });
            db.ref(`rooms/${STATE.roomId}/quizState`).set({
                currentIndex: 0, total: STATE.quizQuestionsData.length, showingAnswer: false, finished: false
            });
            for (let i = 1; i <= TOTAL_GROUPS; i++) { db.ref(`rooms/${STATE.roomId}/groups/nhom-${i}/score`).set(0); }
            db.ref(`rooms/${STATE.roomId}/quizAnswers`).remove();
            document.getElementById('quiz-setup-area').style.display = 'none';
            document.getElementById('quiz-control-area').style.display = '';
            document.getElementById('quiz-ranking-area').style.display = '';
            startTeacherRankingListener();
            sendQuizQuestion(0);
        });
    });
}

function sendQuizQuestion(index) {
    const q = STATE.quizQuestionsData[index];
    // [SECURITY] Reset flag — ẩn đáp án cho đến khi hết giờ hoặc tất cả HS trả lời
    STATE.quizAnswerRevealed = false;
    db.ref(`rooms/${STATE.roomId}/quizState`).update({
        currentIndex: index, showingAnswer: false, startedAt: Date.now()
    });
    db.ref(`rooms/${STATE.roomId}/currentQuizQuestion`).set(q);
    document.getElementById('quiz-progress-text').textContent = `Câu ${index + 1}/${STATE.quizQuestionsData.length}`;
    document.getElementById('quiz-progress-fill').style.width = `${((index + 1) / STATE.quizQuestionsData.length) * 100}%`;
    // Update teacher-specific counter badge (renamed to avoid duplicate ID)
    const teacherCounter = document.getElementById('teacher-quiz-question-counter');
    if (teacherCounter) teacherCounter.textContent = `Câu ${index + 1}/${STATE.quizQuestionsData.length}`;
    document.getElementById('quiz-teacher-question').innerHTML = `<div class="quiz-question-text">${q.content}</div>`;
    // Timer
    let remaining = q.timeLimit;
    clearInterval(STATE.timerInterval);
    STATE.timerInterval = setInterval(() => {
        remaining--;
        if (remaining <= 0) { clearInterval(STATE.timerInterval); showQuizAnswer(index); }
    }, 1000);
    // Listen answers real-time
    listenQuizAnswerStats(index);
    
    // Show "Xem kết quả" button, hide Next and End
    document.getElementById('btn-quiz-show-answer').style.display = '';
    document.getElementById('btn-quiz-next').style.display = 'none';
    document.getElementById('btn-quiz-end').style.display = 'none';
    document.getElementById('quiz-groups-result').style.display = 'none';
    // [SECURITY] Ẩn biểu đồ và stats chi tiết khi câu mới bắt đầu
    document.getElementById('quiz-bar-chart').style.display = 'none';
}

function showQuizAnswer(index) {
    // [SECURITY] Bật flag → cho phép hiện Đúng/Sai + biểu đồ
    STATE.quizAnswerRevealed = true;
    db.ref(`rooms/${STATE.roomId}/quizState`).update({ showingAnswer: true });
    clearInterval(STATE.timerInterval);
    
    // Hide "Xem kết quả" button
    document.getElementById('btn-quiz-show-answer').style.display = 'none';
    
    // Hiện danh sách nhóm đúng/sai
    document.getElementById('quiz-groups-result').style.display = '';
    
    // [SECURITY] Re-render stats với đầy đủ Đúng/Sai (vì flag đã bật)
    const qId = STATE.quizQuestionsData[index].id;
    db.ref(`rooms/${STATE.roomId}/quizAnswers/${qId}`).once('value', snap => {
        _renderQuizStats(STATE.quizQuestionsData[index], snap.val() || {});
    });
    
    // Highlight đáp án đúng trên biểu đồ
    const q = STATE.quizQuestionsData[index];
    if (q.type === 'multiple-choice') {
        document.querySelectorAll('.bar-item').forEach(b => b.classList.remove('highlight'));
        const correctIdx = ['A','B','C','D'].indexOf(q.correct);
        const correctBar = document.querySelectorAll('.bar-item')[correctIdx];
        if (correctBar) correctBar.classList.add('highlight');
    }
    
    // Cập nhật bảng xếp hạng real-time (giống giao diện học sinh)
    loadTeacherRanking();
    
    // Show Next or End based on question index
    if (index >= STATE.quizQuestionsData.length - 1) {
        document.getElementById('btn-quiz-next').style.display = 'none';
        document.getElementById('btn-quiz-end').style.display = '';
    } else {
        document.getElementById('btn-quiz-next').style.display = '';
        document.getElementById('btn-quiz-end').style.display = 'none';
    }
}

function nextQuizQuestion() {
    STATE.quizCurrentIndex++;
    if (STATE.quizCurrentIndex < STATE.quizQuestionsData.length) {
        // Hide teacher's result overlay temporarily while counting down
        document.getElementById('quiz-groups-result').style.display = 'none';
        
        // Kahoot flow: 3s countdown before next question starts
        startActivityCountdown(`Câu ${STATE.quizCurrentIndex + 1}`, () => {
            sendQuizQuestion(STATE.quizCurrentIndex);
        });
    }
}

function endQuiz() {
    db.ref(`rooms/${STATE.roomId}/quizState`).update({ finished: true });
    clearInterval(STATE.timerInterval);
    playSound('timeup');
    saveQuizSessionHistory();
    stopTeacherRankingListener();
    loadTeacherRanking();

    // Kiểm tra: nếu đang trong lesson plan → gọi lpStopStep
    db.ref(`rooms/${STATE.roomId}/lessonStepIndex`).once('value', snap => {
        const stepIdx = snap.val();
        if (stepIdx !== null && stepIdx !== undefined && stepIdx >= 0) {
            lpStopStep(stepIdx);
        } else {
            // Đặt trạng thái idle → học sinh quiz sẽ nhận và quay về trang chủ
            db.ref(`rooms/${STATE.roomId}`).update({ status: 'idle', mode: null });
            showToast('Đã kết thúc trắc nghiệm!', 'info');
        }
    });
}

function listenQuizAnswerStats(index) {
    const q = STATE.quizQuestionsData[index];
    const qId = q.id;
    db.ref(`rooms/${STATE.roomId}/quizAnswers/${qId}`).on('value', snap => {
        const answers = snap.val() || {};
        const total = Object.keys(answers).length;

        // [SECURITY] Tính nhóm online thực tế (có members) để kiểm tra "tất cả đã trả lời"
        // Nếu tất cả nhóm đã trả lời → auto-reveal kết quả
        if (total > 0 && total >= TOTAL_GROUPS && !STATE.quizAnswerRevealed) {
            showQuizAnswer(index);
            return;
        }

        _renderQuizStats(q, answers);
    });
}

// [SECURITY] Render stats dựa theo STATE.quizAnswerRevealed
// Khi chưa reveal: chỉ hiện "Đã trả lời X/N" — ẨN Đúng/Sai + biểu đồ
// Khi revealed: hiện đầy đủ
function _renderQuizStats(q, answers) {
    const total = Object.keys(answers).length;
    const correctArr = Object.entries(answers).filter(([,a]) => a.isCorrect);
    const wrongArr = Object.entries(answers).filter(([,a]) => !a.isCorrect);
    const revealed = STATE.quizAnswerRevealed;

    // Counts — luôn hiện "Đã trả lời", chỉ hiện Đúng/Sai khi revealed
    if (revealed) {
        document.getElementById('quiz-stats-counts').innerHTML = `
            <div class="quiz-stat-bar"><span class="qs-label">Đã trả lời</span><span class="qs-count">${total}/${TOTAL_GROUPS}</span></div>
            <div class="quiz-stat-bar"><span class="qs-label">Đúng</span><span class="qs-count" style="color:#00ff88">${correctArr.length}</span></div>
            <div class="quiz-stat-bar"><span class="qs-label">Sai</span><span class="qs-count" style="color:var(--danger)">${wrongArr.length}</span></div>`;
    } else {
        document.getElementById('quiz-stats-counts').innerHTML = `
            <div class="quiz-stat-bar"><span class="qs-label">Đã trả lời</span><span class="qs-count">${total}/${TOTAL_GROUPS}</span></div>
            <div class="quiz-stat-bar"><span class="qs-label">Đúng</span><span class="qs-count" style="color:var(--text-dim)">?</span></div>
            <div class="quiz-stat-bar"><span class="qs-label">Sai</span><span class="qs-count" style="color:var(--text-dim)">?</span></div>`;
    }

    // Bar chart (chỉ cho multiple-choice) — chỉ hiện khi revealed
    if (q.type === 'multiple-choice' && revealed) {
        const opts = {A:0, B:0, C:0, D:0};
        Object.values(answers).forEach(a => { if (opts[a.answer] !== undefined) opts[a.answer]++; });
        const max = Math.max(...Object.values(opts), 1);
        const colors = {A:'var(--quiz-red)', B:'var(--quiz-blue)', C:'var(--quiz-yellow)', D:'var(--quiz-green)'};
        let barHtml = '';
        ['A','B','C','D'].forEach(opt => {
            const pct = (opts[opt]/max)*100;
            const isCorrectOpt = opt === q.correct;
            barHtml += `<div class="bar-item ${isCorrectOpt ? 'correct-bar' : ''}">
                <div class="bar-fill" style="height:${pct}%;background:${colors[opt]}"></div>
                <span class="bar-label">${opt}</span>
                <span class="bar-count">${opts[opt]}</span>
            </div>`;
        });
        document.getElementById('quiz-bar-chart').innerHTML = barHtml;
        document.getElementById('quiz-bar-chart').style.display = '';
    } else if (!revealed) {
        document.getElementById('quiz-bar-chart').style.display = 'none';
    }

    // Danh sách nhóm đúng/sai — chỉ render khi revealed
    if (revealed) {
        document.getElementById('quiz-groups-correct').innerHTML =
            '<span class="groups-label">✅ Đúng:</span> ' +
            (correctArr.length > 0 ? correctArr.map(([g]) => `<span class="group-chip correct">${g}</span>`).join('') : '<span style="color:var(--text-muted)">Chưa có</span>');
        document.getElementById('quiz-groups-wrong').innerHTML =
            '<span class="groups-label">❌ Sai:</span> ' +
            (wrongArr.length > 0 ? wrongArr.map(([g]) => `<span class="group-chip wrong">${g}</span>`).join('') : '<span style="color:var(--text-muted)">Chưa có</span>');
    }
}

function loadTeacherRanking() {
    // Cập nhật subtitle hiển thị câu hiện tại
    const subtitleEl = document.getElementById('teacher-lb-subtitle');
    if (subtitleEl && STATE.quizQuestionsData) {
        subtitleEl.textContent = `Sau câu ${(STATE.quizCurrentIndex || 0) + 1}/${STATE.quizQuestionsData.length}`;
    }

    db.ref(`rooms/${STATE.roomId}/groups`).once('value', snap => {
        renderTeacherLeaderboard(snap.val() || {});
    });
}

function renderTeacherLeaderboard(groups) {
    const list = document.getElementById('quiz-ranking-list');
    if (!list) return;
    const sorted = Object.entries(groups)
        .filter(([_, g]) => g.members && g.members.length > 0)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

    if (sorted.length === 0) {
        list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có dữ liệu</p>';
        return;
    }

    const topScore = sorted[0] ? (sorted[0][1].score || 1) : 1;
    const medals = ['🥇', '🥈', '🥉'];

    // Previous ranking for shuffle animation
    const prevRankMap = STATE._prevTeacherRanking || {};
    const prevScoreMap = STATE._prevTeacherScores || {};
    const hasPrev = Object.keys(prevRankMap).length > 0;
    const ROW_HEIGHT = 52;

    list.innerHTML = '';
    const rowEls = [];
    sorted.forEach(([key, g], newIdx) => {
        const score = g.score || 0;
        const prevScore = prevScoreMap[key] || 0;
        const scoreGain = score - prevScore;
        const pct = topScore > 0 ? Math.round((score / topScore) * 100) : 0;
        const medal = newIdx < 3 ? medals[newIdx] : '';
        const rankClass = newIdx === 0 ? 'gold' : newIdx === 1 ? 'silver' : newIdx === 2 ? 'bronze' : '';
        const name = g.members ? g.members[0] : '';
        const groupNum = key.replace('nhom-', '');

        // Rank change
        const oldIdx = prevRankMap[key] !== undefined ? prevRankMap[key] : newIdx;
        const delta = oldIdx - newIdx;
        let changeBadge = '';
        if (hasPrev && delta > 0) changeBadge = `<span class="lb-rank-change up">↑${delta}</span>`;
        else if (hasPrev && delta < 0) changeBadge = `<span class="lb-rank-change down">↓${Math.abs(delta)}</span>`;

        let gainBadge = '';
        if (hasPrev && scoreGain > 0) gainBadge = `<span class="lb-score-gain">+${scoreGain}</span>`;

        const row = document.createElement('div');
        row.className = `lb-row ${rankClass}`;
        row.style.position = 'relative';
        row.style.opacity = '0';
        row.style.transform = 'translateX(60px)';
        row.innerHTML = `
            <div class="lb-rank-col">
                ${medal ? `<span class="lb-medal">${medal}</span>` : `<span class="lb-rank-num">${newIdx + 1}</span>`}
                ${changeBadge}
            </div>
            <div class="lb-info-col">
                <div class="lb-player-name">Nhóm ${groupNum}${name ? ' — ' + name : ''} ${gainBadge}</div>
                <div class="lb-score-bar-bg">
                    <div class="lb-score-bar-fill ${rankClass}" style="width:0%" data-target="${pct}"></div>
                </div>
            </div>
            <div class="lb-score-col">${score}<span class="lb-score-unit">đ</span></div>`;
        list.appendChild(row);
        rowEls.push({ row, newIdx, oldIdx, delta });
    });

    // Phase 1: Slide in from old positions
    rowEls.forEach(({ row, newIdx, oldIdx }, arrIdx) => {
        const offset = hasPrev ? (oldIdx - newIdx) * ROW_HEIGHT : 0;
        setTimeout(() => {
            row.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            row.style.opacity = '1';
            row.style.transform = `translateX(0) translateY(${offset}px)`;
            setTimeout(() => {
                const bar = row.querySelector('.lb-score-bar-fill');
                if (bar) bar.style.width = bar.dataset.target + '%';
            }, 200);
        }, arrIdx * 100 + 100);
    });

    // Phase 2: Rank shuffle
    if (hasPrev) {
        const shuffleDelay = rowEls.length * 100 + 600;
        setTimeout(() => {
            rowEls.forEach(({ row, delta }) => {
                row.style.transition = 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)';
                row.style.transform = 'translateX(0) translateY(0)';
                if (delta !== 0) {
                    row.classList.add('lb-shuffling');
                    setTimeout(() => row.classList.remove('lb-shuffling'), 800);
                }
            });
        }, shuffleDelay);
    }

    // Save for next comparison
    STATE._prevTeacherRanking = {};
    STATE._prevTeacherScores = {};
    sorted.forEach(([key, g], i) => {
        STATE._prevTeacherRanking[key] = i;
        STATE._prevTeacherScores[key] = g.score || 0;
    });
}

// Real-time listener cho ranking — gắn khi quiz bắt đầu, gỡ khi kết thúc
function startTeacherRankingListener() {
    stopTeacherRankingListener(); // Gỡ listener cũ nếu có
    STATE._teacherRankingRef = db.ref(`rooms/${STATE.roomId}/groups`);
    STATE._teacherRankingRef.on('value', snap => {
        // Chỉ cập nhật khi quiz-ranking-area đang hiển thị
        const area = document.getElementById('quiz-ranking-area');
        if (area && area.style.display !== 'none') {
            renderTeacherLeaderboard(snap.val() || {});
        }
    });
}

function stopTeacherRankingListener() {
    if (STATE._teacherRankingRef) {
        STATE._teacherRankingRef.off();
        STATE._teacherRankingRef = null;
    }
}

/* === 11. QUIZ MODULE - STUDENT === */
function initQuizStudent() {
    // [BUG 4] Gỡ mọi listener cũ trước khi gắn mới — tránh duplicate khi vào lại activity
    const _qbase = `rooms/${STATE.roomId}`;
    db.ref(`${_qbase}/quizState`).off();
    db.ref(`${_qbase}/currentQuizQuestion`).off();
    db.ref(`${_qbase}/groups/nhom-${STATE.groupNumber}/score`).off();
    db.ref(`${_qbase}/status`).off();

    document.getElementById('quiz-student-group').textContent = `Nhóm ${STATE.groupNumber}`;
    
    // Per-question state flags
    STATE.quizStudentAnswered = false;
    STATE.quizShowingAnswerHandled = false; // guard: prevent handling showingAnswer more than once per question
    STATE.recentQuizResult = null;

    // Listen quiz state changes (showingAnswer, finished, currentIndex)
    db.ref(`rooms/${STATE.roomId}/quizState`).on('value', snap => {
        const qs = snap.val();
        if (!qs) return;

        // Update question counter
        const counterEl = document.getElementById('quiz-question-counter');
        if (counterEl && qs.total) {
            counterEl.textContent = `Câu ${(qs.currentIndex || 0) + 1}/${qs.total}`;
        }

        // Handle finished state
        if (qs.finished) {
            clearTimeout(STATE.quizLeaderboardTimeout);
            showQuizFinalStudent();
            return;
        }

        // showingAnswer: trigger result → leaderboard → waiting sequence
        // Guard flag prevents this from running >1 time per question
        if (qs.showingAnswer && !STATE.quizShowingAnswerHandled) {
            STATE.quizShowingAnswerHandled = true;
            clearInterval(STATE.timerInterval);
            clearTimeout(STATE.quizLeaderboardTimeout);

            // Hide submitted waiting screen
            document.getElementById('quiz-submitted-overlay').style.display = 'none';

            // Step 1: Show result (correct / wrong / timeout)
            if (STATE.quizStudentAnswered) {
                showStoredQuizResult();
            } else {
                revealCorrectAnswerToStudent();
            }

            // Step 2: After 3s, replace result with leaderboard
            STATE.quizLeaderboardTimeout = setTimeout(() => {
                document.getElementById('quiz-result-overlay').style.display = 'none';
                showQuizResultStudent(() => {
                    // Step 3: After leaderboard auto-hides (5s), show waiting screen
                    document.getElementById('quiz-waiting-overlay').style.display = '';
                });
            }, 3000);
        }
    });

    // Listen current question — fires when teacher sends a new question
    db.ref(`rooms/${STATE.roomId}/currentQuizQuestion`).on('value', snap => {
        const q = snap.val();
        if (!q) return;

        // Cancel any pending leaderboard transition from previous question
        clearTimeout(STATE.quizLeaderboardTimeout);

        // Reset per-question state for the new question
        STATE.quizStudentAnswered = false;
        STATE.quizShowingAnswerHandled = false;
        STATE.recentQuizResult = null;

        STATE.currentStudentQuizQ = q;
        renderStudentQuizQuestion(q);
    });

    // Listen own score
    db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}/score`).on('value', snap => {
        document.getElementById('quiz-student-score').textContent = `${snap.val() || 0} điểm`;
    });

    // Lắng nghe trạng thái phòng → khi GV kết thúc/dừng quiz, về trang chủ ngay
    db.ref(`rooms/${STATE.roomId}/status`).on('value', snap => {
        const st = snap.val();
        if (st === 'idle' || st === 'waiting' || st === 'lesson-waiting' || !st) {
            // Dọn dẹp tất cả listeners quiz
            clearInterval(STATE.timerInterval);
            clearInterval(STATE.finalReturnInterval);
            clearTimeout(STATE.quizLeaderboardTimeout);
            db.ref(`rooms/${STATE.roomId}/quizState`).off();
            db.ref(`rooms/${STATE.roomId}/currentQuizQuestion`).off();
            db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}/score`).off();
            db.ref(`rooms/${STATE.roomId}/status`).off();
            showScreen('student-home');
            initStudentHome();
            showToast('Hoạt động kết thúc. Chào mừng trở lại! 🏠', 'info');
        }
    });
}

function revealCorrectAnswerToStudent() {
    const q = STATE.currentStudentQuizQ;
    if (!q) return;
    // Disable all option buttons
    document.querySelectorAll('.quiz-option-btn').forEach(b => b.classList.add('disabled'));
    // Highlight correct answer
    if (q.type === 'multiple-choice') {
        const btn = document.getElementById(`quiz-opt-${q.correct.toLowerCase()}`);
        if (btn) btn.classList.add('correct');
    } else if (q.type === 'true-false') {
        const btn = document.getElementById(`quiz-opt-${q.correct}`);
        if (btn) btn.classList.add('correct');
    }

    // Timeout result card — Kahoot-style
    clearInterval(STATE.submittedCountdownInterval);
    document.getElementById('quiz-submitted-overlay').style.display = 'none';

    const overlay = document.getElementById('quiz-result-overlay');
    const card = document.getElementById('result-card');
    const icon = document.getElementById('quiz-result-icon');
    const resultText = document.getElementById('quiz-result-text');
    const resultPoints = document.getElementById('quiz-result-points');
    const ripple = document.getElementById('result-ripple');
    const starsEl = document.getElementById('result-stars');

    overlay.style.display = '';
    void overlay.offsetWidth;

    card.className = 'result-card timeout-card';
    icon.innerHTML = '<i class="fas fa-clock"></i>';
    icon.className = 'result-icon-wrap timeout-icon';
    resultText.textContent = '⏰ Hết giờ!';
    resultPoints.textContent = `Đáp án đúng: ${q.correct}`;
    starsEl.style.display = 'none';

    ripple.className = 'result-ripple';
    void ripple.offsetWidth;
    ripple.className = 'result-ripple ripple-wrong';
    playSound('timeup');
}

function renderStudentQuizQuestion(q) {
    document.getElementById('quiz-question-text').textContent = q.content;
    // Hide all overlays
    document.querySelectorAll('#quiz-answer-area > div').forEach(d => d.style.display = 'none');
    document.getElementById('quiz-result-overlay').style.display = 'none';
    document.getElementById('quiz-submitted-overlay').style.display = 'none';
    document.getElementById('quiz-leaderboard-overlay').style.display = 'none';
    document.getElementById('quiz-waiting-overlay').style.display = 'none';
    // Start countdown
    startQuizStudentTimer(q.timeLimit);
    if (q.type === 'multiple-choice') {
        const mc = document.getElementById('quiz-mc-options');
        mc.style.display = '';
        ['A','B','C','D'].forEach(opt => {
            const btn = document.getElementById(`quiz-opt-${opt.toLowerCase()}`);
            btn.querySelector('.option-text').textContent = q.options[opt];
            btn.className = `quiz-option-btn quiz-${opt==='A'?'red':opt==='B'?'blue':opt==='C'?'yellow':'green'}`;
            btn.onclick = () => submitQuizAnswer(q, opt);
        });
    } else if (q.type === 'true-false') {
        document.getElementById('quiz-tf-options').style.display = '';
        document.getElementById('quiz-opt-true').className = 'quiz-option-btn quiz-green quiz-tf-btn';
        document.getElementById('quiz-opt-false').className = 'quiz-option-btn quiz-red quiz-tf-btn';
        document.getElementById('quiz-opt-true').onclick = () => submitQuizAnswer(q, 'true');
        document.getElementById('quiz-opt-false').onclick = () => submitQuizAnswer(q, 'false');
    } else if (q.type === 'fill-blank') {
        document.getElementById('quiz-fill-options').style.display = '';
        const sentence = q.content.replace(/___/g, '<span class="fill-blank">___</span>');
        document.getElementById('quiz-fill-sentence').innerHTML = sentence;
        document.getElementById('quiz-fill-input').value = '';
        document.getElementById('btn-quiz-fill-submit').onclick = () => {
            const val = document.getElementById('quiz-fill-input').value.trim();
            submitQuizAnswer(q, val);
        };
    } else if (q.type === 'drag-drop') {
        document.getElementById('quiz-drag-options').style.display = '';
        const correctItems = q.correct.split('|');
        const distractors = q.distractors ? q.distractors.split('|') : [];
        const allItems = [...correctItems, ...distractors].sort(() => Math.random() - 0.5);
        // Render sentence with drop zones
        let sentenceHtml = q.content;
        correctItems.forEach((_, i) => {
            sentenceHtml = sentenceHtml.replace(`[${i+1}]`, `<span class="drop-zone" data-index="${i}" ondrop="handleDrop(event)" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')"></span>`);
        });
        document.getElementById('quiz-drag-sentence').innerHTML = sentenceHtml;
        // Render draggable items
        const pool = document.getElementById('quiz-drag-pool');
        pool.innerHTML = '';
        allItems.forEach(item => {
            const el = document.createElement('div');
            el.className = 'drag-item';
            el.draggable = true;
            el.textContent = item;
            el.dataset.value = item; // [BUG 13] Lưu giá trị vào data-value để so sánh chính xác
            el.ondragstart = (e) => { e.dataTransfer.setData('text', item); };
            pool.appendChild(el);
        });
        document.getElementById('btn-quiz-drag-submit').onclick = () => {
            const zones = document.querySelectorAll('#quiz-drag-sentence .drop-zone');
            const answers = Array.from(zones).map(z => z.textContent.trim());
            submitQuizAnswer(q, answers.join('|'));
        };
    } else if (q.type === 'image-match') {
        document.getElementById('quiz-image-match-options').style.display = '';
        // Firebase trả về object {0:{...}, 1:{...}} thay vì array → phải convert lại
        const pairsRaw = q.pairs || {};
        const pairs = Array.isArray(pairsRaw) ? pairsRaw : Object.values(pairsRaw);

        if (pairs.length === 0) {
            document.getElementById('im-image-pool').innerHTML = '<p style="color:rgba(255,255,255,0.4)">Không có dữ liệu</p>';
            return;
        }

        // Shuffle image order for display
        const shuffledIndices = pairs.map((_, i) => i).sort(() => Math.random() - 0.5);

        // Render image pool (left column) - shuffled
        const imgPool = document.getElementById('im-image-pool');
        imgPool.innerHTML = '';
        shuffledIndices.forEach(origIdx => {
            const p = pairs[origIdx];
            if (!p) return;
            const card = document.createElement('div');
            card.className = 'im-drag-card';
            card.draggable = true;
            card.dataset.origidx = origIdx;
            card.innerHTML = `<img src="${p.imageData || ''}" alt="Ảnh ${origIdx + 1}"><span class="im-card-num">${origIdx + 1}</span>`;
            card.ondragstart = (e) => {
                e.dataTransfer.setData('im-idx', String(origIdx));
                card.classList.add('dragging');
            };
            card.ondragend = () => card.classList.remove('dragging');
            imgPool.appendChild(card);
        });

        // Render label + drop zones (right column) - in original order
        const zonesEl = document.getElementById('im-label-zones');
        zonesEl.innerHTML = '';
        pairs.forEach((p, labelIdx) => {
            if (!p) return;
            const row = document.createElement('div');
            row.className = 'im-label-row';
            row.innerHTML = `
                <div class="im-drop-zone" data-labelidx="${labelIdx}"
                    ondragover="event.preventDefault();this.classList.add('drag-over')"
                    ondragleave="this.classList.remove('drag-over')"
                    ondrop="handleImDrop(event, ${labelIdx})">
                    <span class="im-drop-empty"><i class="fas fa-image"></i></span>
                </div>
                <span class="im-label-text">${p.label}</span>`;
            zonesEl.appendChild(row);
        });

        // Submit: collect which imageIndex dropped in each label zone
        document.getElementById('btn-quiz-im-submit').onclick = () => {
            const dropZones = document.querySelectorAll('#im-label-zones .im-drop-zone');
            // Check all zones have an image (droppedidx attribute exists)
            const hasEmpty = Array.from(dropZones).some(z => z.dataset.droppedidx === undefined || z.dataset.droppedidx === '');
            if (hasEmpty) { showToast('Hãy ghép tất cả hình trước khi nộp!', 'error'); return; }
            const answer = Array.from(dropZones).map(z => z.dataset.droppedidx).join('|');
            submitQuizAnswer(q, answer);
        };
    }
    // Hide overlays
    document.getElementById('quiz-result-overlay').style.display = 'none';
    document.getElementById('quiz-leaderboard-overlay').style.display = 'none';
    document.getElementById('quiz-final-overlay').style.display = 'none';
    document.getElementById('quiz-waiting-overlay').style.display = 'none';
    // Reset groups result for GV
    const grResult = document.getElementById('quiz-groups-result');
    if (grResult) grResult.style.display = 'none';
}

// Global drag handler (drag-drop type - text items)
window.handleDrop = function(e) {
    e.preventDefault();
    const item = e.dataTransfer.getData('text');
    // [BUG 13] Dùng dataset.value thay textContent để tránh lỗi so sánh ký tự Unicode
    const oldVal = e.target.dataset.droppedValue;
    if (oldVal) {
        document.querySelectorAll('.drag-item').forEach(d => {
            if (d.dataset.value === oldVal) d.classList.remove('used');
        });
    }
    e.target.textContent = item;
    e.target.dataset.droppedValue = item;
    e.target.classList.add('filled');
    e.target.classList.remove('drag-over');
    // Mark source item as used
    document.querySelectorAll('.drag-item').forEach(d => { if (d.dataset.value === item) d.classList.add('used'); });
};

// Global drag handler for image-match type
window.handleImDrop = function(e, labelIdx) {
    e.preventDefault();
    const origIdx = e.dataTransfer.getData('im-idx');
    if (origIdx === '' || origIdx === null || origIdx === undefined) return;
    const zone = document.querySelector(`.im-drop-zone[data-labelidx="${labelIdx}"]`);
    if (!zone) return;
    // Un-place old card if zone already had one (re-drop) — MUST read BEFORE overwriting
    const oldDroppedIdx = zone.dataset.droppedidx;
    if (oldDroppedIdx !== undefined && oldDroppedIdx !== '' && oldDroppedIdx !== origIdx) {
        const oldCard = document.querySelector(`.im-drag-card[data-origidx="${oldDroppedIdx}"]`);
        if (oldCard) oldCard.classList.remove('placed');
    }
    // Find source image card
    const srcCard = document.querySelector(`.im-drag-card[data-origidx="${origIdx}"]`);
    const imgSrc = srcCard ? srcCard.querySelector('img').src : '';
    zone.innerHTML = `<img src="${imgSrc}" class="im-dropped-img"><span class="im-drop-clear" onclick="clearImDrop(${labelIdx}, ${origIdx})">✕</span>`;
    zone.dataset.droppedidx = origIdx;
    zone.classList.remove('drag-over');
    // Place new card
    if (srcCard) srcCard.classList.add('placed');
};

// Clear a drop zone (allow re-drag)
window.clearImDrop = function(labelIdx, origIdx) {
    const zone = document.querySelector(`.im-drop-zone[data-labelidx="${labelIdx}"]`);
    if (!zone) return;
    zone.innerHTML = `<span class="im-drop-empty"><i class="fas fa-image"></i></span>`;
    delete zone.dataset.droppedidx;
    // Restore source card
    const srcCard = document.querySelector(`.im-drag-card[data-origidx="${origIdx}"]`);
    if (srcCard) srcCard.classList.remove('placed');
};

function startQuizStudentTimer(duration) {
    clearInterval(STATE.timerInterval);
    STATE.quizTimerRemaining = duration; // Lưu để submitQuizAnswer đọc được
    const circle = document.getElementById('quiz-countdown-circle');
    const text = document.getElementById('quiz-countdown-text');
    const circumference = 2 * Math.PI * 54;
    circle.style.strokeDasharray = circumference;
    const update = () => {
        text.textContent = STATE.quizTimerRemaining;
        circle.style.strokeDashoffset = circumference * (1 - STATE.quizTimerRemaining / duration);
        circle.style.stroke = STATE.quizTimerRemaining < 6 ? 'var(--danger)' : 'var(--success)';
        if (STATE.quizTimerRemaining <= 0) {
            clearInterval(STATE.timerInterval);
            // Hết giờ mà HS chưa chọn → tự động thông báo
            if (!STATE.quizStudentAnswered) {
                revealCorrectAnswerToStudent();
            }
            return;
        }
        STATE.quizTimerRemaining--;
    };
    update();
    STATE.timerInterval = setInterval(update, 1000);
}

function submitQuizAnswer(question, answer) {
    if (STATE.quizStudentAnswered) return; // tránh gửi 2 lần
    STATE.quizStudentAnswered = true;
    clearInterval(STATE.timerInterval);

    // Đọc thời gian còn lại từ STATE (chính xác hơn đọc DOM text)
    const timeLeft = Math.max(0, STATE.quizTimerRemaining || 0);
    const isCorrect = checkQuizAnswer(question, answer);
    const points = isCorrect ? Math.round(question.points * (0.5 + 0.5 * timeLeft / question.timeLimit)) : 0;
    db.ref(`rooms/${STATE.roomId}/quizAnswers/${question.id}/nhom-${STATE.groupNumber}`).set({
        answer, isCorrect, points, answeredAt: Date.now()
    });
    if (isCorrect) {
        db.ref(`rooms/${STATE.roomId}/groups/nhom-${STATE.groupNumber}/score`).transaction(s => (s || 0) + points);
    }
    // Disable all buttons
    document.querySelectorAll('.quiz-option-btn').forEach(b => b.classList.add('disabled'));
    document.querySelectorAll('.quiz-tf-btn').forEach(b => b.classList.add('disabled'));
    // Hiệu ứng đúng/sai trên nút
    if (question.type === 'multiple-choice') {
        if (isCorrect) {
            document.getElementById(`quiz-opt-${answer.toLowerCase()}`).classList.add('correct');
        } else {
            document.getElementById(`quiz-opt-${answer.toLowerCase()}`).style.animation = 'shakeWrong 0.5s';
            document.getElementById(`quiz-opt-${question.correct.toLowerCase()}`).classList.add('correct');
        }
    } else if (question.type === 'true-false') {
        if (isCorrect) {
            document.getElementById(`quiz-opt-${answer}`).classList.add('correct');
        } else {
            document.getElementById(`quiz-opt-${answer}`).style.animation = 'shakeWrong 0.5s';
            document.getElementById(`quiz-opt-${question.correct}`).classList.add('correct');
        }
    }
    
    // Store result to show LATER when time is up / teacher shows answer
    STATE.recentQuizResult = { isCorrect, points };
    
    // Hiện overlay "Đã nộp" Kahoot-style
    document.getElementById('quiz-submitted-overlay').style.display = '';
    
    // SVG circle r=50 → circumference = 2π×50 = 314.16
    const circumference = 2 * Math.PI * 50;
    const circle = document.getElementById('submitted-countdown-circle');
    const textEl = document.getElementById('submitted-countdown-text');
    let cdTimeLeft = timeLeft;
    
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = 0;
    if (textEl) textEl.textContent = cdTimeLeft;
    if (circle) circle.classList.remove('danger');

    clearInterval(STATE.submittedCountdownInterval);
    STATE.submittedCountdownInterval = setInterval(() => {
        cdTimeLeft--;
        const remaining = Math.max(0, cdTimeLeft);
        if (textEl) textEl.textContent = remaining;
        // Ring thu dần
        if (circle) {
            circle.style.strokeDashoffset = circumference * (1 - remaining / (timeLeft || 1));
            if (remaining <= 5) circle.classList.add('danger');
        }
        if (cdTimeLeft <= 0) clearInterval(STATE.submittedCountdownInterval);
    }, 1000);
}

function showStoredQuizResult() {
    if (!STATE.recentQuizResult) return;
    const { isCorrect, points } = STATE.recentQuizResult;

    // Dừng countdown ring
    clearInterval(STATE.submittedCountdownInterval);
    document.getElementById('quiz-submitted-overlay').style.display = 'none';

    const overlay = document.getElementById('quiz-result-overlay');
    const card = document.getElementById('result-card');
    const icon = document.getElementById('quiz-result-icon');
    const resultText = document.getElementById('quiz-result-text');
    const resultPoints = document.getElementById('quiz-result-points');
    const ripple = document.getElementById('result-ripple');
    const starsEl = document.getElementById('result-stars');
    const scoreFloat = document.getElementById('score-float-popup');

    // Reset trước khi show
    overlay.style.display = '';
    card.className = 'result-card';
    starsEl.style.display = 'none';
    scoreFloat.className = 'score-float-popup';
    scoreFloat.textContent = '';
    // Force reflow để animation chạy lại
    void overlay.offsetWidth;

    if (isCorrect) {
        playSound('correct');
        card.classList.add('correct-card');
        icon.innerHTML = '<i class="fas fa-check-circle"></i>';
        icon.className = 'result-icon-wrap correct-icon';
        resultText.textContent = '✨ Chính xác!';
        resultPoints.textContent = `+${points} điểm`;
        starsEl.style.display = 'flex';
        // Ripple xanh
        ripple.className = 'result-ripple ripple-correct';
        void ripple.offsetWidth;
        ripple.className = 'result-ripple ripple-correct';
        // Score float animation
        setTimeout(() => {
            scoreFloat.textContent = `+${points}đ`;
            scoreFloat.classList.add('floating');
        }, 400);
        // Confetti nhẹ
        _launchQuizConfetti();
    } else {
        playSound('wrong');
        card.classList.add('wrong-card');
        icon.innerHTML = '<i class="fas fa-times-circle"></i>';
        icon.className = 'result-icon-wrap wrong-icon';
        resultText.textContent = '❌ Sai rồi!';
        resultPoints.textContent = '0 điểm';
        starsEl.style.display = 'none';
        // Ripple đỏ
        ripple.className = 'result-ripple ripple-wrong';
        void ripple.offsetWidth;
        ripple.className = 'result-ripple ripple-wrong';
        // Screen shake
        const wrapper = document.querySelector('.quiz-wrapper');
        if (wrapper) {
            wrapper.classList.remove('shake');
            void wrapper.offsetWidth;
            wrapper.classList.add('shake');
            setTimeout(() => wrapper.classList.remove('shake'), 700);
        }
    }
}

function checkQuizAnswer(q, answer) {
    if (q.type === 'multiple-choice' || q.type === 'true-false') return answer === q.correct;
    if (q.type === 'fill-blank') return answer.toLowerCase().trim() === q.correct.toLowerCase().trim();
    if (q.type === 'drag-drop') return answer === q.correct;
    if (q.type === 'image-match') {
        // Check each label-to-imageIndex mapping
        const correctMapping = q.correct.split('|'); // ['0','1','2'...]
        const studentMapping = answer.split('|');
        if (studentMapping.length !== correctMapping.length) return false;
        return correctMapping.every((val, i) => studentMapping[i] === val);
    }
    return false;
}

function showQuizResultStudent(onClose) {
    db.ref(`rooms/${STATE.roomId}/groups`).once('value', snap => {
        const groups = snap.val() || {};
        const sorted = Object.entries(groups)
            .filter(([_, g]) => g.members && g.members.length > 0)
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
        const myKey = `nhom-${STATE.groupNumber}`;
        const myIdx = sorted.findIndex(([k]) => k === myKey);
        const myRank = myIdx >= 0 ? myIdx + 1 : sorted.length + 1;
        const myScore = (myIdx >= 0 && groups[myKey]?.score) ? groups[myKey].score : 0;
        const topScore = sorted[0] ? (sorted[0][1].score || 1) : 1;
        document.getElementById('quiz-student-rank').textContent = myRank > 0 ? `#${myRank}` : '--';

        // Build current ranking map: key → newRank
        const newRankMap = {};
        sorted.forEach(([key], i) => { newRankMap[key] = i; });

        // Previous ranking (from last leaderboard show)
        const prevRankMap = STATE._prevStudentRanking || {};
        const prevScoreMap = STATE._prevStudentScores || {};

        // Update subtitle
        const quizState = document.getElementById('quiz-question-counter')?.textContent || '';
        document.getElementById('lb-subtitle').textContent = quizState;

        // Show my rank highlight
        const myRankEl = document.getElementById('lb-my-rank');
        const medals = ['🥇', '🥈', '🥉'];
        const myMedal = (myRank >= 1 && myRank <= 3) ? medals[myRank - 1] : `#${myRank}`;
        const rankLabel = (myRank >= 1 && myRank <= 3) ? `Top ${myRank}!` : `Hạng ${myRank}/${sorted.length}`;
        const myPrevRank = prevRankMap[myKey] !== undefined ? prevRankMap[myKey] + 1 : myRank;
        const myRankDelta = myPrevRank - myRank; // positive = moved up
        let myRankBadge = '';
        if (myRankDelta > 0) myRankBadge = `<span class="lb-rank-change up">↑${myRankDelta}</span>`;
        else if (myRankDelta < 0) myRankBadge = `<span class="lb-rank-change down">↓${Math.abs(myRankDelta)}</span>`;
        myRankEl.innerHTML = `
            <div class="lb-my-medal">${myMedal}</div>
            <div class="lb-my-info">
                <div class="lb-my-name">Nhóm ${STATE.groupNumber} — ${STATE.studentName || ''}</div>
                <div class="lb-my-score">${myScore} điểm ${myRankBadge}</div>
            </div>
            <div class="lb-my-rank-num">${rankLabel}</div>`;

        // Render leaderboard list
        const overlay = document.getElementById('quiz-leaderboard-overlay');
        const list = document.getElementById('quiz-leaderboard-list');
        document.getElementById('quiz-waiting-overlay').style.display = 'none';
        document.getElementById('quiz-result-overlay').style.display = 'none';
        overlay.style.display = '';

        // Build rows — initially at OLD positions, then animate to NEW positions
        list.innerHTML = '';
        const ROW_HEIGHT = 52; // approximate height of each lb-row + margin
        const hasPrev = Object.keys(prevRankMap).length > 0;
        const rowEls = [];

        sorted.slice(0, 8).forEach(([key, g], newIdx) => {
            const isMe = key === myKey;
            const score = g.score || 0;
            const prevScore = prevScoreMap[key] || 0;
            const scoreGain = score - prevScore;
            const pct = topScore > 0 ? Math.round((score / topScore) * 100) : 0;
            const medal = newIdx < 3 ? medals[newIdx] : '';
            const rankClass = newIdx === 0 ? 'gold' : newIdx === 1 ? 'silver' : newIdx === 2 ? 'bronze' : '';
            const name = g.members ? g.members[0] : '';
            const groupNum = key.replace('nhom-', '');

            // Rank change badge
            const oldIdx = prevRankMap[key] !== undefined ? prevRankMap[key] : newIdx;
            const delta = oldIdx - newIdx; // positive = moved up
            let changeBadge = '';
            if (hasPrev && delta > 0) changeBadge = `<span class="lb-rank-change up">↑${delta}</span>`;
            else if (hasPrev && delta < 0) changeBadge = `<span class="lb-rank-change down">↓${Math.abs(delta)}</span>`;

            // Score gain badge
            let gainBadge = '';
            if (hasPrev && scoreGain > 0) gainBadge = `<span class="lb-score-gain">+${scoreGain}</span>`;

            const row = document.createElement('div');
            row.className = `lb-row ${isMe ? 'lb-me' : ''} ${rankClass}`;
            row.style.position = 'relative';
            row.style.opacity = '0';
            row.style.transform = 'translateX(60px)';
            row.innerHTML = `
                <div class="lb-rank-col">
                    ${medal ? `<span class="lb-medal">${medal}</span>` : `<span class="lb-rank-num">${newIdx + 1}</span>`}
                    ${changeBadge}
                </div>
                <div class="lb-info-col">
                    <div class="lb-player-name">${isMe ? '⭐ ' : ''}Nhóm ${groupNum}${name ? ' — ' + name : ''} ${gainBadge}</div>
                    <div class="lb-score-bar-bg">
                        <div class="lb-score-bar-fill ${rankClass}" style="width:0%" data-target="${pct}"></div>
                    </div>
                </div>
                <div class="lb-score-col">${score}<span class="lb-score-unit">đ</span></div>`;
            list.appendChild(row);
            rowEls.push({ row, newIdx, oldIdx, delta, key });
        });

        // Phase 1: Staggered slide-in from old positions
        rowEls.forEach(({ row, newIdx, oldIdx, delta }, arrIdx) => {
            // If has previous ranking, start from old visual position (offset)
            const offset = hasPrev ? (oldIdx - newIdx) * ROW_HEIGHT : 0;
            setTimeout(() => {
                row.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                row.style.opacity = '1';
                row.style.transform = `translateX(0) translateY(${offset}px)`;
                // Animate score bar
                setTimeout(() => {
                    const bar = row.querySelector('.lb-score-bar-fill');
                    if (bar) bar.style.width = bar.dataset.target + '%';
                }, 200);
            }, arrIdx * 100 + 100);
        });

        // Phase 2: After all rows visible, animate rank shuffle (rows slide to final positions)
        if (hasPrev) {
            const shuffleDelay = rowEls.length * 100 + 600;
            setTimeout(() => {
                rowEls.forEach(({ row, delta }) => {
                    row.style.transition = 'transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)';
                    row.style.transform = 'translateX(0) translateY(0)';
                    // Flash highlight on rows that moved
                    if (delta !== 0) {
                        row.classList.add('lb-shuffling');
                        setTimeout(() => row.classList.remove('lb-shuffling'), 800);
                    }
                });
            }, shuffleDelay);
        }

        // Save current ranking for next comparison
        STATE._prevStudentRanking = {};
        STATE._prevStudentScores = {};
        sorted.forEach(([key, g], i) => {
            STATE._prevStudentRanking[key] = i;
            STATE._prevStudentScores[key] = g.score || 0;
        });

        // Auto-hide after animation completes
        const totalDuration = hasPrev ? (rowEls.length * 100 + 600 + 700 + 2500) : 5500;
        setTimeout(() => {
            overlay.style.display = 'none';
            if (typeof onClose === 'function') onClose();
        }, totalDuration);
    });
}

/* Confetti mini cho result overlay khi trả lời đúng */
function _launchQuizConfetti() {
    const canvas = document.getElementById('quiz-confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth || 400;
    canvas.height = canvas.offsetHeight || 600;

    const colors = ['#00ff88','#667eea','#f5576c','#ffd700','#00d4ff','#ff6b9d'];
    const particles = Array.from({length: 80}, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * 0.4,
        r: Math.random() * 7 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 5,
        vy: Math.random() * 3 + 2,
        alpha: 1,
        rot: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8
    }));

    let frame = 0;
    const maxFrames = 90;
    let raf;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r * 0.6);
            ctx.restore();
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15; // gravity
            p.rot += p.rotSpeed;
            if (frame > maxFrames * 0.5) p.alpha -= 0.025;
        });
        frame++;
        if (frame < maxFrames) raf = requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    cancelAnimationFrame(raf);
    draw();
}

function showQuizFinalStudent() {

    const overlay = document.getElementById('quiz-final-overlay');
    overlay.style.display = '';

    // Create confetti
    createConfetti();
    playSound('correct');

    const podium = document.getElementById('quiz-final-podium');
    db.ref(`rooms/${STATE.roomId}/groups`).once('value', snap => {
        const groups = snap.val() || {};
        const myKey = `nhom-${STATE.groupNumber}`;
        const sorted = Object.entries(groups)
            .filter(([_, g]) => g.members && g.members.length > 0)
            .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
        const topScore = sorted[0] ? (sorted[0][1].score || 0) : 1;
        const myRank = sorted.findIndex(([k]) => k === myKey) + 1;
        const medals = ['🥇', '🥈', '🥉'];
        const podiumHeights = ['120px', '90px', '65px'];
        const podiumColors = ['linear-gradient(180deg, #FFD700, #FFA500)', 'linear-gradient(180deg, #C0C0C0, #8C8C8C)', 'linear-gradient(180deg, #CD7F32, #8B5E3C)'];

        let html = '';
        // Top 3 podium
        if (sorted.length >= 1) {
            html += '<div class="final-podium-stage">';
            // Podium shows 2nd, 1st, 3rd in that order for visual layout
            const order = sorted.length >= 3 ? [1, 0, 2] : sorted.length >= 2 ? [1, 0] : [0];
            order.forEach(idx => {
                if (!sorted[idx]) return;
                const [key, g] = sorted[idx];
                const name = g.members ? g.members[0] : '';
                const groupNum = key.replace('nhom-', '');
                const isMe = key === myKey;
                html += `<div class="podium-col ${isMe ? 'podium-me' : ''}" style="animation-delay:${idx * 0.2}s">
                    <div class="podium-avatar">${medals[idx]}</div>
                    <div class="podium-name">${isMe ? '⭐ ' : ''}Nhóm ${groupNum}</div>
                    <div class="podium-member">${name}</div>
                    <div class="podium-points">${g.score || 0}đ</div>
                    <div class="podium-bar" style="height:${podiumHeights[idx]};background:${podiumColors[idx]}">
                        <span class="podium-place">${idx + 1}</span>
                    </div>
                </div>`;
            });
            html += '</div>';
        }

        // Full ranking list
        html += '<div class="final-full-list">';
        sorted.forEach(([key, g], i) => {
            const isMe = key === myKey;
            const score = g.score || 0;
            const pct = topScore > 0 ? Math.round((score / topScore) * 100) : 0;
            const name = g.members ? g.members[0] : '';
            const groupNum = key.replace('nhom-', '');
            html += `<div class="final-row ${isMe ? 'final-me' : ''}" style="animation-delay:${(i + 3) * 0.08}s">
                <span class="final-rank">${i < 3 ? medals[i] : i + 1}</span>
                <span class="final-name">${isMe ? '⭐ ' : ''}Nhóm ${groupNum} — ${name}</span>
                <div class="final-bar-bg"><div class="final-bar-fill" style="width:${pct}%"></div></div>
                <span class="final-score">${score}đ</span>
            </div>`;
        });
        html += '</div>';

        // Add countdown footer to return home
        html += `<div class="final-return-footer" id="final-return-footer">
                    <i class="fas fa-home"></i> Quay về trang chủ sau <span id="final-return-countdown">10</span>s
                 </div>`;

        podium.innerHTML = html;

        // Auto-return to student home after 10 seconds
        let cdSec = 10;
        clearInterval(STATE.finalReturnInterval);
        STATE.finalReturnInterval = setInterval(() => {
            cdSec--;
            const cdEl = document.getElementById('final-return-countdown');
            if (cdEl) cdEl.textContent = cdSec;
            if (cdSec <= 0) {
                clearInterval(STATE.finalReturnInterval);
                clearInterval(STATE.timerInterval);
                db.ref(`rooms/${STATE.roomId}/quizState`).off();
                db.ref(`rooms/${STATE.roomId}/currentQuizQuestion`).off();
                overlay.style.display = 'none';
                showScreen('student-home');
                initStudentHome();
                showToast('Bạn đã quay về trang chủ! 🏠', 'success');
            }
        }, 1000);
    });
}

function createConfetti() {
    const container = document.getElementById('final-confetti');
    container.innerHTML = '';
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#A78BFA', '#FF8C42', '#00C853', '#FF4081'];
    for (let i = 0; i < 60; i++) {
        const particle = document.createElement('div');
        particle.className = 'confetti-particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.animationDelay = Math.random() * 3 + 's';
        particle.style.animationDuration = (2 + Math.random() * 3) + 's';
        particle.style.width = (4 + Math.random() * 8) + 'px';
        particle.style.height = (4 + Math.random() * 8) + 'px';
        container.appendChild(particle);
    }
}

/* === 12. NEW FEATURES: TIMER CONTROLS, RANDOM PICKER, SOUND, RESET, RANKING, HISTORY, EXPORT === */

/* --- Timer Controls (Pause/Resume/Extend) --- */
function initTimerControls() {
    document.getElementById('btn-timer-pause').addEventListener('click', () => {
        STATE.timerPaused = true;
        db.ref(`rooms/${STATE.roomId}/timer`).update({ paused: true, remaining: STATE.timerRemaining });
        document.getElementById('btn-timer-pause').style.display = 'none';
        document.getElementById('btn-timer-resume').style.display = '';
        showToast('Tạm dừng đếm ngược', 'info');
    });
    document.getElementById('btn-timer-resume').addEventListener('click', () => {
        STATE.timerPaused = false;
        db.ref(`rooms/${STATE.roomId}/timer`).update({ paused: false, remaining: STATE.timerRemaining, startedAt: Date.now(), duration: STATE.timerRemaining });
        document.getElementById('btn-timer-resume').style.display = 'none';
        document.getElementById('btn-timer-pause').style.display = '';
        showToast('Tiếp tục đếm ngược', 'info');
    });
    document.getElementById('btn-timer-add1').addEventListener('click', () => {
        STATE.timerRemaining += 60;
        STATE.timerDuration += 60;
        db.ref(`rooms/${STATE.roomId}/timer`).update({ remaining: STATE.timerRemaining, duration: STATE.timerDuration });
        document.getElementById('teacher-disc-time').textContent = formatTime(STATE.timerRemaining);
        showToast('+1 phút', 'success');
    });
    document.getElementById('btn-timer-add2').addEventListener('click', () => {
        STATE.timerRemaining += 120;
        STATE.timerDuration += 120;
        db.ref(`rooms/${STATE.roomId}/timer`).update({ remaining: STATE.timerRemaining, duration: STATE.timerDuration });
        document.getElementById('teacher-disc-time').textContent = formatTime(STATE.timerRemaining);
        showToast('+2 phút', 'success');
    });
}

/* --- Random Group Picker --- */
function initRandomPicker() {
    document.getElementById('btn-random-group').addEventListener('click', () => {
        document.getElementById('random-picker-overlay').style.display = '';
        document.getElementById('random-result').textContent = '';
        document.getElementById('random-display').textContent = '?';
    });
    document.getElementById('btn-random-close').addEventListener('click', () => {
        document.getElementById('random-picker-overlay').style.display = 'none';
    });
    document.getElementById('btn-random-spin').addEventListener('click', spinRandom);
}

function spinRandom() {
    // Lấy danh sách nhóm online, lọc bỏ nhóm đã chọn
    db.ref(`rooms/${STATE.roomId}/groups`).once('value', snap => {
        const groups = snap.val() || {};
        const onlineGroups = [];
        for (let i = 1; i <= TOTAL_GROUPS; i++) {
            const g = groups[`nhom-${i}`];
            if (g && g.online && !STATE.randomPickedGroups.includes(i)) {
                onlineGroups.push(i);
            }
        }
        if (onlineGroups.length === 0) {
            STATE.randomPickedGroups = []; // Reset
            showToast('Tất cả nhóm đã được chọn, đã reset!', 'info');
            return;
        }
        // Animation quay
        const display = document.getElementById('random-display');
        const result = document.getElementById('random-result');
        display.classList.add('spinning');
        result.textContent = '';
        let count = 0;
        const spinInterval = setInterval(() => {
            display.textContent = onlineGroups[Math.floor(Math.random() * onlineGroups.length)];
            count++;
            if (count >= 20) {
                clearInterval(spinInterval);
                const chosen = onlineGroups[Math.floor(Math.random() * onlineGroups.length)];
                display.classList.remove('spinning');
                display.textContent = chosen;
                STATE.randomPickedGroups.push(chosen);
                const g = groups[`nhom-${chosen}`];
                result.textContent = `Nhóm ${chosen}${g && g.members ? ' — ' + g.members[0] : ''}`;
                playSound('correct');
            }
        }, 80);
    });
}

/* --- Sound Module (Web Audio API) --- */
function initSoundToggle() {
    document.getElementById('btn-toggle-sound').addEventListener('click', () => {
        STATE.soundEnabled = !STATE.soundEnabled;
        const btn = document.getElementById('btn-toggle-sound');
        btn.innerHTML = STATE.soundEnabled ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
        btn.classList.toggle('muted', !STATE.soundEnabled);
        showToast(STATE.soundEnabled ? 'Đã bật âm thanh' : 'Đã tắt âm thanh', 'info');
    });
}

// [FIX B14] Tái sử dụng 1 AudioContext duy nhất thay vì tạo mới mỗi lần
let _sharedAudioCtx = null;
function _getAudioCtx() {
    if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
        _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume nếu bị suspended (do browser policy)
    if (_sharedAudioCtx.state === 'suspended') {
        _sharedAudioCtx.resume().catch(() => {});
    }
    return _sharedAudioCtx;
}

function playSound(type) {
    if (!STATE.soundEnabled) return;
    try {
        const ctx = _getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.3;
        if (type === 'start' || type === 'newQuestion') {
            osc.frequency.value = 880; osc.type = 'sine';
            osc.start(); osc.stop(ctx.currentTime + 0.3);
        } else if (type === 'warning') {
            osc.frequency.value = 440; osc.type = 'square';
            osc.start(); osc.stop(ctx.currentTime + 0.5);
        } else if (type === 'timeup') {
            osc.frequency.value = 330; osc.type = 'sawtooth';
            osc.start(); osc.stop(ctx.currentTime + 0.8);
        } else if (type === 'correct') {
            osc.frequency.value = 660; osc.type = 'sine';
            osc.start();
            setTimeout(() => { osc.frequency.value = 880; }, 150);
            osc.stop(ctx.currentTime + 0.4);
        } else if (type === 'wrong') {
            osc.frequency.value = 200; osc.type = 'sawtooth';
            osc.start(); osc.stop(ctx.currentTime + 0.4);
        }
    } catch (e) { /* Ignore audio errors */ }
}

/* --- Reset Room --- */
function initResetRoom() {
    document.getElementById('btn-new-session').addEventListener('click', () => {
        if (!confirm('Bạn có chắc muốn bắt đầu phiên mới?\nCâu trả lời và đánh giá sẽ bị xóa, câu hỏi và nhóm được giữ lại.')) return;
        db.ref(`rooms/${STATE.roomId}/answers`).remove();
        db.ref(`rooms/${STATE.roomId}/evaluations`).remove();
        db.ref(`rooms/${STATE.roomId}/peerReviews`).remove();
        db.ref(`rooms/${STATE.roomId}/quizAnswers`).remove();
        db.ref(`rooms/${STATE.roomId}/quizState`).remove();
        db.ref(`rooms/${STATE.roomId}/currentQuestion`).remove();
        db.ref(`rooms/${STATE.roomId}/currentQuizQuestion`).remove();
        db.ref(`rooms/${STATE.roomId}/timer`).remove();
        db.ref(`rooms/${STATE.roomId}/reactions`).remove();
        db.ref(`rooms/${STATE.roomId}/discussionAnswers`).remove();
        db.ref(`rooms/${STATE.roomId}/lessonPlan`).remove();
        db.ref(`rooms/${STATE.roomId}/lessonStepIndex`).remove();
        // [FIX B8] Reset điểm quiz cho tất cả nhóm
        for (let i = 1; i <= TOTAL_GROUPS; i++) {
            db.ref(`rooms/${STATE.roomId}/groups/nhom-${i}/score`).set(0);
        }
        db.ref(`rooms/${STATE.roomId}/status`).set('waiting');
        STATE.randomPickedGroups = [];
        document.getElementById('stat-submitted').textContent = '0';
        showToast('Phiên mới đã bắt đầu!', 'success');
    });
    document.getElementById('btn-reset-room').addEventListener('click', () => {
        if (!confirm('⚠️ RESET TOÀN BỘ \nTất cả dữ liệu sẽ bị xóa, học sinh sẽ tự động đăng nhập lại.\n\nBạn có chắc không?')) return;
        // Ghi flag reset trước khi xóa → HS sẽ phát hiện và tự reload
        db.ref(`rooms/${STATE.roomId}/resetAt`).set(Date.now()).then(() => {
            // Đợi 1s cho HS nhận signal, rồi xóa toàn bộ
            setTimeout(() => {
                db.ref(`rooms/${STATE.roomId}`).remove();
                STATE.randomPickedGroups = [];
                showToast('Đã reset toàn bộ!', 'success');
                setTimeout(() => location.reload(), 500);
            }, 1000);
        });
    });
}

/* --- Discussion Ranking --- */
// [FIX B7] Listen cả evaluations + groups song song, tránh lồng .once() trong .on()
function initDiscussionRanking() {
    let _rankGroups = {};
    let _rankEvals = {};
    function _renderRanking() {
        const list = document.getElementById('disc-ranking-list');
        if (Object.keys(_rankEvals).length === 0) {
            list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có đánh giá</p>';
            return;
        }
        const rankings = [];
        for (let i = 1; i <= TOTAL_GROUPS; i++) {
            const key = `nhom-${i}`;
            const g = _rankGroups[key];
            const ev = _rankEvals[key];
            if (g && g.members && g.members.length > 0 && ev) {
                rankings.push({ group: i, name: g.members[0], stars: ev.stars || 0, comment: ev.comment || '' });
            }
        }
        rankings.sort((a, b) => b.stars - a.stars);
        list.innerHTML = '';
        rankings.forEach((r, i) => {
            list.innerHTML += `<div class="disc-ranking-item">
                <span class="rank-num">${i + 1}</span>
                <span class="rank-name">Nhóm ${r.group} — ${r.name}</span>
                <span class="rank-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span>
                <span class="rank-score">${r.stars}★</span>
            </div>`;
        });
    }
    db.ref(`rooms/${STATE.roomId}/groups`).on('value', snap => {
        _rankGroups = snap.val() || {};
        _renderRanking();
    });
    db.ref(`rooms/${STATE.roomId}/evaluations`).on('value', snap => {
        _rankEvals = snap.val() || {};
        _renderRanking();
    });
}

/* --- Session History --- */
function saveSessionHistory(type) {
    db.ref(`rooms/${STATE.roomId}/currentQuestion`).once('value', qSnap => {
        const q = qSnap.val();
        db.ref(`rooms/${STATE.roomId}/answers`).once('value', aSnap => {
            const answers = aSnap.val() || {};
            db.ref(`rooms/${STATE.roomId}/evaluations`).once('value', eSnap => {
                const evals = eSnap.val() || {};
                const sessionData = {
                    type: type,
                    question: q ? (q.title || q.content) : 'Không rõ',
                    timestamp: Date.now(),
                    answerCount: Object.keys(answers).length,
                    evalCount: Object.keys(evals).length,
                    answers: answers,
                    evaluations: evals
                };
                db.ref(`sessionHistory`).push(sessionData);
            });
        });
    });
}

function saveQuizSessionHistory() {
    db.ref(`rooms/${STATE.roomId}/groups`).once('value', snap => {
        const groups = snap.val() || {};
        const sorted = Object.entries(groups).filter(([_, g]) => g.members && g.members.length > 0).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
        db.ref(`sessionHistory`).push({
            type: 'quiz',
            question: `Trắc nghiệm ${STATE.quizSelectedQuestions.length} câu`,
            timestamp: Date.now(),
            answerCount: sorted.length,
            rankings: sorted.map(([k, g], i) => ({ rank: i + 1, group: k, name: g.members[0], score: g.score || 0 }))
        });
    });
}

function initSessionHistory() {
    const filterEl = document.getElementById('history-filter');
    if (filterEl) {
        filterEl.addEventListener('change', loadSessionHistory);
    }
    loadSessionHistory();
}

function loadSessionHistory() {
    const filter = document.getElementById('history-filter');
    const filterVal = filter ? filter.value : 'all';
    // [FIX B5] Gỡ listener cũ trước khi gắn mới — tránh listener tích lũy
    db.ref('sessionHistory').off();
    db.ref('sessionHistory').orderByChild('timestamp').limitToLast(50).on('value', snap => {
        const sessions = snap.val() || {};
        const list = document.getElementById('session-history-list');
        const keys = Object.keys(sessions).reverse();
        const filtered = keys.filter(k => filterVal === 'all' || sessions[k].type === filterVal);
        if (filtered.length === 0) {
            list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có dữ liệu</p>';
            return;
        }
        list.innerHTML = '';
        filtered.forEach(k => {
            const s = sessions[k];
            const date = new Date(s.timestamp).toLocaleString('vi');
            list.innerHTML += `<div class="history-item">
                <div class="history-header">
                    <span class="history-type ${s.type}">${s.type === 'discussion' ? '💬 Thảo luận' : '🎯 Trắc nghiệm'}</span>
                    <span class="history-date">${date}</span>
                </div>
                <div class="history-title">${s.question}</div>
                <div class="history-details">
                    <span><i class="fas fa-users"></i> ${s.answerCount || 0} nhóm</span>
                    ${s.evalCount ? `<span><i class="fas fa-star"></i> ${s.evalCount} đánh giá</span>` : ''}
                </div>
            </div>`;
        });
    });
}

/* --- Export Excel (CSV with BOM for Vietnamese) --- */
function initExportExcel() {
    document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);
}

function exportToExcel() {
    db.ref('sessionHistory').orderByChild('timestamp').limitToLast(100).once('value', snap => {
        const sessions = snap.val() || {};
        const keys = Object.keys(sessions).reverse();
        if (keys.length === 0) { showToast('Chưa có dữ liệu!', 'error'); return; }

        // BOM cho UTF-8 Excel
        let csv = '\uFEFF';
        csv += 'STT,Loại,Câu hỏi,Thời gian,Số nhóm trả lời,Số đánh giá\n';
        keys.forEach((k, i) => {
            const s = sessions[k];
            const date = new Date(s.timestamp).toLocaleString('vi');
            const type = s.type === 'discussion' ? 'Thảo luận' : 'Trắc nghiệm';
            csv += `${i + 1},"${type}","${(s.question || '').replace(/"/g, '""')}","${date}",${s.answerCount || 0},${s.evalCount || 0}\n`;
        });

        // Thêm bảng chi tiết đánh giá nếu có
        csv += '\n\n--- CHI TIẾT ĐÁNH GIÁ ---\n';
        csv += 'Phiên,Nhóm,Số sao,Nhận xét,Câu trả lời\n';
        keys.forEach((k, i) => {
            const s = sessions[k];
            if (s.answers) {
                Object.keys(s.answers).forEach(g => {
                    const a = s.answers[g];
                    const ev = s.evaluations && s.evaluations[g] ? s.evaluations[g] : {};
                    csv += `${i + 1},"${g}",${ev.stars || 0},"${(ev.comment || '').replace(/"/g, '""')}","${(a.content || '').replace(/"/g, '""')}"\n`;
                });
            }
        });

        // Tải file
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bao_cao_day_hoc_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Đã xuất báo cáo!', 'success');
    });
}
/* === 12A. LESSON PLAN ENGINE === */

/* --- Builder State --- */
const LP_BUILDER = { steps: [], editingPlanId: null };

function initLessonPlanBuilder() {
    // Add step buttons
    document.getElementById('btn-lp-add-disc').addEventListener('click', () => lpAddStep('discussion'));
    document.getElementById('btn-lp-add-quiz').addEventListener('click', () => lpAddStep('quiz'));
    document.getElementById('btn-lp-add-homework').addEventListener('click', () => lpAddStep('homework'));
    document.getElementById('btn-lp-add-summary').addEventListener('click', () => lpAddStep('summary'));
    document.getElementById('btn-lp-save').addEventListener('click', lpSavePlan);
    document.getElementById('btn-lp-end').addEventListener('click', lpEndLesson);

    // Load saved plans
    lpLoadSavedPlans();
}

/* --- Step Types Config --- */
const STEP_TYPES = {
    discussion: { icon: 'fas fa-comments', label: 'Thảo luận', color: 'var(--primary)' },
    quiz: { icon: 'fas fa-gamepad', label: 'Trắc nghiệm', color: 'var(--quiz-yellow)' },
    homework: { icon: 'fas fa-home', label: 'Nhiệm vụ về nhà', color: '#38ef7d' },
    summary: { icon: 'fas fa-chart-pie', label: 'Tổng kết', color: 'var(--success)' }
};

/* --- Builder Functions --- */
function lpAddStep(type) {
    const step = {
        id: Date.now().toString(36),
        type: type,
        title: `${STEP_TYPES[type].label} ${LP_BUILDER.steps.filter(s => s.type === type).length + 1}`,
        questionId: '',
        quizQuestions: [],
        homeworkId: ''
    };
    LP_BUILDER.steps.push(step);
    lpRenderBuilderSteps();
}

function lpRemoveStep(stepId) {
    LP_BUILDER.steps = LP_BUILDER.steps.filter(s => s.id !== stepId);
    lpRenderBuilderSteps();
}

function lpMoveStep(stepId, direction) {
    const idx = LP_BUILDER.steps.findIndex(s => s.id === stepId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= LP_BUILDER.steps.length) return;
    [LP_BUILDER.steps[idx], LP_BUILDER.steps[newIdx]] = [LP_BUILDER.steps[newIdx], LP_BUILDER.steps[idx]];
    lpRenderBuilderSteps();
}

function lpRenderBuilderSteps() {
    const list = document.getElementById('lp-steps-list');
    if (LP_BUILDER.steps.length === 0) {
        list.innerHTML = '<p class="empty-state"><i class="fas fa-arrow-up"></i> Nhấn nút ở trên để thêm hoạt động</p>';
        return;
    }
    list.innerHTML = LP_BUILDER.steps.map((step, i) => {
        const cfg = STEP_TYPES[step.type];
        let configHtml = '';
        if (step.type === 'discussion') {
            configHtml = `<div class="lp-step-config">
                <label>Câu hỏi thảo luận:</label>
                <select class="lp-step-question" data-step-id="${step.id}" onchange="lpUpdateStepQuestion(this)">
                    <option value="">-- Chọn câu hỏi --</option>
                </select>
            </div>`;
        } else if (step.type === 'quiz') {
            configHtml = `<div class="lp-step-config">
                <label>Chọn câu hỏi trắc nghiệm:</label>
                <div class="lp-quiz-select" id="lp-quiz-select-${step.id}">Đang tải...</div>
            </div>`;
        } else if (step.type === 'homework') {
            configHtml = `<div class="lp-step-config">
                <label>Chọn nhiệm vụ về nhà:</label>
                <select class="lp-step-homework" data-step-id="${step.id}" onchange="lpUpdateStepHomework(this)">
                    <option value="">-- Chọn nhiệm vụ đã soạn --</option>
                </select>
            </div>`;
        } else {
            configHtml = `<div class="lp-step-config">
                <label>Mô tả tổng kết:</label>
                <input type="text" class="lp-step-desc" data-step-id="${step.id}" value="${step.title}" placeholder="VD: Nhận xét chung" onchange="lpUpdateStepTitle(this)">
            </div>`;
        }
        return `<div class="lp-step-item" data-step-id="${step.id}">
            <div class="lp-step-header">
                <span class="lp-step-num">${i + 1}</span>
                <span class="lp-step-icon" style="color:${cfg.color}"><i class="${cfg.icon}"></i></span>
                <input type="text" class="lp-step-title-input" value="${step.title}" onchange="lpUpdateStepTitleInput(this, '${step.id}')">
                <div class="lp-step-actions">
                    <button class="tool-btn mini" onclick="lpMoveStep('${step.id}',-1)" title="Lên"><i class="fas fa-chevron-up"></i></button>
                    <button class="tool-btn mini" onclick="lpMoveStep('${step.id}',1)" title="Xuống"><i class="fas fa-chevron-down"></i></button>
                    <button class="tool-btn mini danger" onclick="lpRemoveStep('${step.id}')" title="Xóa"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            ${configHtml}
        </div>`;
    }).join('');

    // Populate question selects after rendering
    LP_BUILDER.steps.forEach(step => {
        if (step.type === 'discussion') {
            const sel = document.querySelector(`.lp-step-question[data-step-id="${step.id}"]`);
            if (sel) lpPopulateDiscQuestions(sel, step.questionId);
        } else if (step.type === 'quiz') {
            lpPopulateQuizQuestions(step);
        } else if (step.type === 'homework') {
            const sel = document.querySelector(`.lp-step-homework[data-step-id="${step.id}"]`);
            if (sel) lpPopulateHomeworkTasks(sel, step.homeworkId);
        }
    });
}

function lpPopulateDiscQuestions(selectEl, selectedId) {
    db.ref('questionBank/discussion').once('value', snap => {
        const qs = snap.val() || {};
        Object.entries(qs).forEach(([id, q]) => {
            const opt = document.createElement('option');
            opt.value = id; opt.textContent = q.title;
            if (id === selectedId) opt.selected = true;
            selectEl.appendChild(opt);
        });
    });
}

function lpPopulateQuizQuestions(step) {
    db.ref('questionBank/quiz').once('value', snap => {
        const qs = snap.val() || {};
        const container = document.getElementById(`lp-quiz-select-${step.id}`);
        if (!container) return;
        container.innerHTML = Object.entries(qs).map(([id, q]) => {
            const checked = step.quizQuestions.includes(id) ? 'checked' : '';
            return `<label class="lp-quiz-checkbox"><input type="checkbox" value="${id}" ${checked} onchange="lpUpdateQuizSelection('${step.id}')"> ${q.content.substring(0, 50)}</label>`;
        }).join('');
    });
}

function lpUpdateStepQuestion(selectEl) {
    const stepId = selectEl.dataset.stepId;
    const step = LP_BUILDER.steps.find(s => s.id === stepId);
    if (step) step.questionId = selectEl.value;
}

function lpUpdateStepTitle(inputEl) {
    const stepId = inputEl.dataset.stepId;
    const step = LP_BUILDER.steps.find(s => s.id === stepId);
    if (step) step.title = inputEl.value;
}

function lpUpdateStepTitleInput(inputEl, stepId) {
    const step = LP_BUILDER.steps.find(s => s.id === stepId);
    if (step) step.title = inputEl.value;
}

function lpUpdateStepTasks(inputEl) {
    const stepId = inputEl.dataset.stepId;
    const step = LP_BUILDER.steps.find(s => s.id === stepId);
    if (step) step.teamTasks = inputEl.value;
}

// Populate homework task dropdown in lesson plan step
function lpPopulateHomeworkTasks(selectEl, selectedId) {
    db.ref('questionBank/homework').once('value', snap => {
        const tasks = snap.val() || {};
        selectEl.innerHTML = '<option value="">-- Chọn nhiệm vụ đã soạn --</option>';
        Object.entries(tasks).forEach(([id, t]) => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = t.title;
            if (id === selectedId) opt.selected = true;
            selectEl.appendChild(opt);
        });
    });
}

function lpUpdateStepHomework(selectEl) {
    const stepId = selectEl.dataset.stepId;
    const step = LP_BUILDER.steps.find(s => s.id === stepId);
    if (step) {
        step.homeworkId = selectEl.value;
        // Also update the step title to match selected homework
        if (selectEl.value) {
            const selectedText = selectEl.options[selectEl.selectedIndex].textContent;
            step.title = selectedText;
        }
    }
}

/* ===========================================================
   HOMEWORK BANK (Ngân hàng nhiệm vụ về nhà)
   Soạn + lưu nhiệm vụ vào questionBank/homework
   =========================================================== */
function initHomeworkBank() {
    // Render team task inputs when the homework tab is shown
    const hwTab = document.getElementById('subtab-qbank-homework');
    if (hwTab) {
        hwTab.addEventListener('click', () => renderHwBankTeamInputs());
    }
    // Also render when team config changes
    db.ref(`rooms/${STATE.roomId}/teamConfig`).on('value', () => {
        if (document.getElementById('qbank-homework')?.classList.contains('active')) {
            renderHwBankTeamInputs();
        }
    });

    function renderHwBankTeamInputs() {
        const area = document.getElementById('hw-task-teams-area');
        if (!area) return;
        db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value', snap => {
            const tc = snap.val();
            if (!tc || !tc.teams || tc.enabled !== true) {
                area.innerHTML = '<p class="empty-state" style="font-size:12px;"><i class="fas fa-info-circle"></i> Bật chế độ tổ ở bên phải và lưu cấu hình tổ trước.</p>';
                return;
            }
            let html = '';
            Object.entries(tc.teams).forEach(([tid, t], idx) => {
                html += `<div class="lp-hw-task-row">
                    <span class="team-color-dot" style="background:${t.color}"></span>
                    <span class="lp-hw-task-team" style="color:${t.color}">${t.name}</span>
                    <input type="text" class="hw-bank-task-input" data-team-idx="${idx}"
                        placeholder="Nhiệm vụ cho ${t.name}...">
                </div>`;
            });
            area.innerHTML = html;
        });
    }

    // Save homework task
    document.getElementById('btn-save-hw-task').addEventListener('click', () => {
        const title = document.getElementById('hw-task-title').value.trim();
        if (!title) { showToast('Nhập tiêu đề nhiệm vụ!', 'error'); return; }
        const taskInputs = document.querySelectorAll('.hw-bank-task-input');
        if (taskInputs.length === 0) { showToast('Chưa có cấu hình tổ!', 'error'); return; }
        const teamTasks = [...taskInputs].map(inp => inp.value.trim());
        const id = 'hw-' + Date.now().toString(36);
        db.ref(`questionBank/homework/${id}`).set({
            title, teamTasks: teamTasks.join('|'), createdAt: Date.now()
        });
        showToast('Đã lưu nhiệm vụ!', 'success');
        document.getElementById('hw-task-title').value = '';
        taskInputs.forEach(inp => inp.value = '');
    });

    // Load and display saved homework tasks
    db.ref('questionBank/homework').on('value', snap => {
        const tasks = snap.val() || {};
        const list = document.getElementById('hw-tasks-list');
        if (Object.keys(tasks).length === 0) {
            list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có nhiệm vụ nào</p>';
            return;
        }
        list.innerHTML = Object.entries(tasks).map(([id, t]) => {
            const taskArr = (t.teamTasks || '').split('|').filter(Boolean);
            const taskPreview = taskArr.length > 0
                ? taskArr.map((tk, i) => `<span class="hw-saved-task-item">Tổ ${i+1}: ${tk}</span>`).join('')
                : '<span style="color:rgba(255,255,255,0.3)">Chưa gán nhiệm vụ tổ</span>';
            return `<div class="saved-question-item">
                <div class="sq-header">
                    <span class="sq-title"><i class="fas fa-home" style="color:#38ef7d"></i> ${t.title}</span>
                    <button class="tool-btn mini danger" onclick="deleteHomeworkTask('${id}')" title="Xóa"><i class="fas fa-trash"></i></button>
                </div>
                <div class="hw-saved-tasks">${taskPreview}</div>
            </div>`;
        }).join('');
    });
}

function deleteHomeworkTask(id) {
    if (!confirm('Xóa nhiệm vụ này?')) return;
    db.ref(`questionBank/homework/${id}`).remove();
    showToast('Đã xóa nhiệm vụ', 'info');
}

function lpUpdateQuizSelection(stepId) {
    const container = document.getElementById(`lp-quiz-select-${stepId}`);
    const selected = [...container.querySelectorAll('input:checked')].map(cb => cb.value);
    const step = LP_BUILDER.steps.find(s => s.id === stepId);
    if (step) step.quizQuestions = selected;
}

/* --- Save / Load Plans --- */
function lpSavePlan() {
    const title = document.getElementById('lp-title').value.trim();
    if (!title) { showToast('Nhập tiêu đề bài dạy!', 'error'); return; }
    if (LP_BUILDER.steps.length === 0) { showToast('Thêm ít nhất 1 hoạt động!', 'error'); return; }

    // Validate steps
    for (let i = 0; i < LP_BUILDER.steps.length; i++) {
        const s = LP_BUILDER.steps[i];
        if (s.type === 'discussion' && !s.questionId) {
            showToast(`Bước ${i+1}: Chưa chọn câu hỏi thảo luận!`, 'error'); return;
        }
        if (s.type === 'quiz' && s.quizQuestions.length === 0) {
            showToast(`Bước ${i+1}: Chưa chọn câu hỏi trắc nghiệm!`, 'error'); return;
        }
        if (s.type === 'homework' && !s.homeworkId) {
            showToast(`Bước ${i+1}: Chưa chọn nhiệm vụ về nhà!`, 'error'); return;
        }
    }

    const planId = LP_BUILDER.editingPlanId || ('lp_' + Date.now().toString(36));
    const plan = {
        title, steps: LP_BUILDER.steps, createdAt: Date.now(), updatedAt: Date.now()
    };
    db.ref(`lessonPlans/${planId}`).set(plan);
    showToast('Đã lưu kế hoạch!', 'success');

    // Reset builder
    LP_BUILDER.steps = [];
    LP_BUILDER.editingPlanId = null;
    document.getElementById('lp-title').value = '';
    lpRenderBuilderSteps();
}

function lpLoadSavedPlans() {
    db.ref('lessonPlans').on('value', snap => {
        const plans = snap.val() || {};
        const list = document.getElementById('lp-saved-list');
        const entries = Object.entries(plans);
        if (entries.length === 0) {
            list.innerHTML = '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có kế hoạch nào</p>';
            return;
        }
        list.innerHTML = entries.map(([id, plan]) => {
            const stepSummary = plan.steps.map(s => STEP_TYPES[s.type]?.label || s.type).join(' → ');
            const date = new Date(plan.createdAt).toLocaleDateString('vi');
            return `<div class="lp-saved-item">
                <div class="lp-saved-info">
                    <span class="lp-saved-title">${plan.title}</span>
                    <span class="lp-saved-steps">${stepSummary}</span>
                    <span class="lp-saved-date">${date}</span>
                </div>
                <div class="lp-saved-actions">
                    <button class="tool-btn" onclick="lpActivatePlan('${id}')" title="Kích hoạt"><i class="fas fa-play"></i></button>
                    <button class="tool-btn" onclick="lpEditPlan('${id}')" title="Sửa"><i class="fas fa-edit"></i></button>
                    <button class="tool-btn danger" onclick="lpDeletePlan('${id}')" title="Xóa"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    });
}

function lpEditPlan(planId) {
    db.ref(`lessonPlans/${planId}`).once('value', snap => {
        const plan = snap.val();
        if (!plan) return;
        LP_BUILDER.editingPlanId = planId;
        LP_BUILDER.steps = plan.steps;
        document.getElementById('lp-title').value = plan.title;
        lpRenderBuilderSteps();
        showToast('Đang sửa kế hoạch. Nhấn Lưu để cập nhật.', 'info');
    });
}

function lpDeletePlan(planId) {
    if (!confirm('Xóa kế hoạch này?')) return;
    db.ref(`lessonPlans/${planId}`).remove();
    showToast('Đã xóa kế hoạch!', 'success');
}

/* === FLEXIBLE LESSON PLAN ENGINE === */

function lpActivatePlan(planId) {
    db.ref(`lessonPlans/${planId}`).once('value', snap => {
        const plan = snap.val();
        if (!plan) return;
        const lessonData = {
            planId, title: plan.title,
            totalSteps: plan.steps.length,
            isActive: true, startedAt: Date.now(),
            activeStep: -1,
            steps: {}
        };
        plan.steps.forEach((step, i) => {
            lessonData.steps[i] = {
                type: step.type,
                title: step.title,
                questionId: step.questionId || null,
                quizQuestions: step.quizQuestions || [],
                status: 'ready',
                answers: {}, evaluations: {}, quizAnswers: {}
            };
        });
        db.ref(`rooms/${STATE.roomId}/lessonPlan`).set(lessonData);
        db.ref(`rooms/${STATE.roomId}`).update({ status: 'lesson-waiting', mode: 'lesson' });
        switchToPanel('panel-teach');
        showToast(`Đã kích hoạt: ${plan.title}`, 'success');
    });
}

function lpRenderActivityCards(lp) {
    const titleEl = document.getElementById('lp-active-title');
    if (titleEl) titleEl.textContent = lp.title;
    const container = document.getElementById('lp-activity-cards');
    if (!container) return;
    const steps = lp.steps || {};
    const activeStep = lp.activeStep !== undefined ? lp.activeStep : -1;

    container.innerHTML = '';
    for (let i = 0; i < lp.totalSteps; i++) {
        const s = steps[i] || {};
        const cfg = STEP_TYPES[s.type] || STEP_TYPES.summary;
        const isActive = activeStep === i;
        const isDone = s.status === 'completed';
        const card = document.createElement('div');
        card.className = `lp-act-card ${isActive ? 'running' : ''} ${isDone ? 'done' : ''}`;

        let statusBadge = '';
        if (isActive) statusBadge = '<span class="lp-act-status running"><i class="fas fa-spinner fa-spin"></i> Đang chạy</span>';
        else if (isDone) statusBadge = '<span class="lp-act-status done"><i class="fas fa-check"></i> Hoàn thành</span>';
        else statusBadge = '<span class="lp-act-status ready"><i class="fas fa-clock"></i> Sẵn sàng</span>';

        let infoHtml = '';
        if (s.type === 'discussion' && s.questionId) {
            infoHtml = `<div class="lp-act-info" id="lp-act-info-${i}"><i class="fas fa-spinner fa-spin"></i></div>`;
        } else if (s.type === 'quiz' && s.quizQuestions && s.quizQuestions.length > 0) {
            infoHtml = `<div class="lp-act-info">${s.quizQuestions.length} câu hỏi</div>`;
        } else if (s.type === 'homework' && s.homeworkId) {
            infoHtml = `<div class="lp-act-info" id="lp-act-hw-info-${i}"><i class="fas fa-spinner fa-spin"></i></div>`;
        }

        let actionBtn = '';
        if (isActive) {
            actionBtn = `<button class="btn-danger lp-act-btn" onclick="lpStopStep(${i})"><i class="fas fa-stop"></i> Dừng</button>`;
        } else if (activeStep === -1) {
            if (isDone) {
                actionBtn = `<button class="btn-secondary lp-act-btn" onclick="lpViewStepResult(${i})"><i class="fas fa-search"></i> Xem kết quả</button>
                             <button class="btn-primary lp-act-btn" onclick="lpRunStep(${i})"><i class="fas fa-redo"></i> Chạy lại</button>`;
            } else {
                actionBtn = `<button class="btn-primary lp-act-btn" onclick="lpRunStep(${i})"><i class="fas fa-play"></i> Bắt đầu</button>`;
            }
        }

        card.innerHTML = `
            <div class="lp-act-card-header">
                <div class="lp-act-card-icon" style="background:${cfg.color}"><i class="${cfg.icon}"></i></div>
                <div class="lp-act-card-title">
                    <strong>Bước ${i + 1}: ${s.title || cfg.label}</strong>
                    ${statusBadge}
                </div>
            </div>
            ${infoHtml}
            <div class="lp-act-card-actions">${actionBtn}</div>`;
        container.appendChild(card);

        if (s.type === 'discussion' && s.questionId) {
            db.ref(`questionBank/discussion/${s.questionId}`).once('value', qSnap => {
                const q = qSnap.val();
                const infoEl = document.getElementById(`lp-act-info-${i}`);
                if (infoEl && q) infoEl.innerHTML = `<i class="fas fa-comments"></i> ${q.title}`;
            });
        }
        if (s.type === 'homework' && s.homeworkId) {
            db.ref(`questionBank/homework/${s.homeworkId}`).once('value', hwSnap => {
                const hw = hwSnap.val();
                const infoEl = document.getElementById(`lp-act-hw-info-${i}`);
                if (infoEl && hw) infoEl.innerHTML = `<i class="fas fa-home" style="color:#38ef7d"></i> ${hw.title}`;
            });
        }
    }
}

function lpRunStep(stepIdx) {
    db.ref(`rooms/${STATE.roomId}/lessonPlan`).once('value', snap => {
        const lp = snap.val();
        if (!lp || !lp.isActive) return;
        const step = lp.steps[stepIdx];
        if (!step) return;

        if (step.type === 'discussion') {
            db.ref(`questionBank/discussion/${step.questionId}`).once('value', qSnap => {
                const q = qSnap.val();
                if (!q) { showToast('Câu hỏi không tồn tại!', 'error'); return; }
                showStartStepConfirm(`💬 ${step.title}`, () => {
                    db.ref(`rooms/${STATE.roomId}/lessonPlan`).update({ activeStep: stepIdx });
                    db.ref(`rooms/${STATE.roomId}/lessonPlan/steps/${stepIdx}/status`).set('active');
                    const questionData = { id: step.questionId, title: q.title, content: q.content, timeLimit: q.timeLimit, startedAt: Date.now() };
                    if (q.imageData) questionData.imageData = q.imageData;
                    db.ref(`rooms/${STATE.roomId}`).update({
                        status: 'discussion', mode: 'discussion',
                        currentQuestion: questionData,
                        lessonStepIndex: stepIdx
                    });
                    db.ref(`rooms/${STATE.roomId}/timer`).set({
                        remaining: q.timeLimit, duration: q.timeLimit, paused: false, startedAt: Date.now()
                    });
                    db.ref(`rooms/${STATE.roomId}/answers`).remove();
                    showActivityView('discussion');
                    document.getElementById('btn-send-discussion').style.display = 'none';
                    document.getElementById('btn-stop-discussion').style.display = '';
                    document.getElementById('disc-answers-area').style.display = '';
                    document.getElementById('timer-controls').style.display = '';
                    STATE.discussionStopped = false; // [BUG 5] Reset guard trước khi bắt đầu
                    startTeacherTimer(q.timeLimit);
                    playSound('start');
                    showToast(`${step.title} — Bắt đầu!`, 'success');
                });
            });
        } else if (step.type === 'quiz') {
            const qIds = step.quizQuestions || [];
            if (qIds.length === 0) { showToast('Chưa chọn câu hỏi quiz!', 'error'); return; }
            const promises = qIds.map(id => db.ref(`questionBank/quiz/${id}`).once('value'));
            Promise.all(promises).then(snaps => {
                STATE.quizQuestionsData = snaps.map((s, i) => ({ id: qIds[i], ...s.val() }));
                STATE.quizCurrentIndex = 0;
                STATE.quizSelectedQuestions = qIds;
                // Reset rank tracking for shuffle animation
                STATE._prevTeacherRanking = {};
                STATE._prevTeacherScores = {};
                STATE._prevStudentRanking = {};
                STATE._prevStudentScores = {};
                showStartStepConfirm(`🎯 ${step.title}`, () => {
                    db.ref(`rooms/${STATE.roomId}/lessonPlan`).update({ activeStep: stepIdx });
                    db.ref(`rooms/${STATE.roomId}/lessonPlan/steps/${stepIdx}/status`).set('active');
                    db.ref(`rooms/${STATE.roomId}`).update({ status: 'quiz', mode: 'quiz', lessonStepIndex: stepIdx });
                    db.ref(`rooms/${STATE.roomId}/quizState`).set({
                        currentIndex: 0, total: STATE.quizQuestionsData.length, showingAnswer: false, finished: false
                    });
                    for (let i = 1; i <= TOTAL_GROUPS; i++) { db.ref(`rooms/${STATE.roomId}/groups/nhom-${i}/score`).set(0); }
                    db.ref(`rooms/${STATE.roomId}/quizAnswers`).remove();
                    showActivityView('quiz');
                    document.getElementById('quiz-setup-area').style.display = 'none';
                    document.getElementById('quiz-control-area').style.display = '';
                    document.getElementById('quiz-ranking-area').style.display = '';
                    startTeacherRankingListener();
                    sendQuizQuestion(0);
                    playSound('start');
                });
            });
        } else if (step.type === 'homework') {
            // Nhiệm vụ về nhà — cần có teamConfig + homework task
            const homeworkId = step.homeworkId;

            // Backward compat: kế hoạch cũ chưa có homeworkId
            if (!homeworkId) {
                db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value', tcSnap => {
                    const tc = tcSnap.val();
                    if (!tc || !tc.teams) { showToast('Chưa cấu hình Tổ!', 'error'); return; }
                    showStartStepConfirm(`🏠 ${step.title}`, () => {
                        db.ref(`rooms/${STATE.roomId}/lessonPlan`).update({ activeStep: stepIdx });
                        db.ref(`rooms/${STATE.roomId}/lessonPlan/steps/${stepIdx}/status`).set('active');
                        const teamTasks = (step.teamTasks || '').split('|').map(s => s.trim()).filter(Boolean);
                        db.ref(`rooms/${STATE.roomId}/homeworkState`).set({
                            active: true, presentingTeam: null,
                            phase: 'waiting', title: step.title,
                            teamTasks: teamTasks, stepIdx: stepIdx
                        });
                        db.ref(`rooms/${STATE.roomId}/homeworkEvals`).remove();
                        db.ref(`rooms/${STATE.roomId}`).update({ status: 'homework', mode: 'homework', lessonStepIndex: stepIdx });
                        showActivityView('homework');
                        renderHomeworkTeacherView(tc);
                        playSound('start');
                        showToast(`${step.title} — Bắt đầu!`, 'success');
                    });
                });
                return;
            }

            // Có homeworkId → load từ questionBank (kế hoạch mới)
            // Load both teamConfig and homework task data
            Promise.all([
                db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value'),
                db.ref(`questionBank/homework/${homeworkId}`).once('value')
            ]).then(([tcSnap, hwSnap]) => {
                const tc = tcSnap.val();
                const hwTask = hwSnap.val();
                if (!tc || !tc.teams) { showToast('Chưa cấu hình Tổ! Vui lòng vào tab Chuẩn bị → Quản lý Tổ.', 'error'); return; }
                if (!hwTask) { showToast('Nhiệm vụ không tồn tại! Đã bị xóa?', 'error'); return; }
                showStartStepConfirm(`🏠 ${hwTask.title}`, () => {
                    db.ref(`rooms/${STATE.roomId}/lessonPlan`).update({ activeStep: stepIdx });
                    db.ref(`rooms/${STATE.roomId}/lessonPlan/steps/${stepIdx}/status`).set('active');
                    const teamTasks = (hwTask.teamTasks || '').split('|').map(s => s.trim()).filter(Boolean);
                    db.ref(`rooms/${STATE.roomId}/homeworkState`).set({
                        active: true, presentingTeam: null,
                        phase: 'waiting', title: hwTask.title,
                        teamTasks: teamTasks, stepIdx: stepIdx,
                        homeworkId: homeworkId
                    });
                    db.ref(`rooms/${STATE.roomId}/homeworkEvals`).remove();
                    db.ref(`rooms/${STATE.roomId}`).update({ status: 'homework', mode: 'homework', lessonStepIndex: stepIdx });
                    showActivityView('homework');
                    renderHomeworkTeacherView(tc);
                    playSound('start');
                    showToast(`${hwTask.title} — Bắt đầu!`, 'success');
                });
            });
        } else if (step.type === 'summary') {
            showStartStepConfirm(`📊 ${step.title}`, () => {
                db.ref(`rooms/${STATE.roomId}/lessonPlan`).update({ activeStep: stepIdx });
                db.ref(`rooms/${STATE.roomId}/lessonPlan/steps/${stepIdx}/status`).set('active');
                showActivityView('summary');
                showToast(`${step.title}`, 'success');
                setTimeout(() => { lpStopStep(stepIdx); }, 3000);
            });
        }
    });
}

function lpStopStep(stepIdx) {
    const basePath = `rooms/${STATE.roomId}`;
    // Dừng mọi timer đang chạy
    clearInterval(STATE.timerInterval);
    STATE.timerPaused = false;
    Promise.all([
        db.ref(`${basePath}/answers`).once('value'),
        db.ref(`${basePath}/evaluations`).once('value'),
        db.ref(`${basePath}/quizAnswers`).once('value'),
        db.ref(`${basePath}/homeworkEvals`).once('value')
    ]).then(([ansSnap, evalSnap, quizSnap, hwSnap]) => {
        const updates = {};
        if (ansSnap.val()) updates[`lessonPlan/steps/${stepIdx}/answers`] = ansSnap.val();
        if (evalSnap.val()) updates[`lessonPlan/steps/${stepIdx}/evaluations`] = evalSnap.val();
        if (quizSnap.val()) updates[`lessonPlan/steps/${stepIdx}/quizAnswers`] = quizSnap.val();
        if (hwSnap.val()) updates[`lessonPlan/steps/${stepIdx}/homeworkEvals`] = hwSnap.val();
        updates[`lessonPlan/steps/${stepIdx}/status`] = 'completed';
        updates[`lessonPlan/steps/${stepIdx}/completedAt`] = Date.now();
        updates['lessonPlan/activeStep'] = -1;
        updates['status'] = 'lesson-waiting';
        updates['mode'] = 'lesson';
        updates['lessonStepIndex'] = null;
        db.ref(basePath).update(updates);
        showActivityView('hide');
        showToast('Hoạt động đã kết thúc — HS về màn hình chờ', 'success');
    });
}

function lpEndLesson() {
    if (!confirm('Kết thúc bài dạy? Dữ liệu sẽ được lưu.')) return;
    db.ref(`rooms/${STATE.roomId}/lessonPlan`).update({ isActive: false, endedAt: Date.now(), activeStep: -1 });
    db.ref(`rooms/${STATE.roomId}`).update({ status: 'idle', mode: null, lessonStepIndex: null });
    showActivityView('hide');
    showToast('Đã kết thúc bài dạy!', 'success');
}

/* === STEP REVIEW — View completed step results === */
function lpViewStepResult(stepIdx) {
    db.ref(`rooms/${STATE.roomId}/lessonPlan/steps/${stepIdx}`).once('value', snap => {
        const step = snap.val();
        if (!step) { showToast('Không tìm thấy dữ liệu!', 'error'); return; }
        const overlay = document.getElementById('step-review-overlay');
        const title = document.getElementById('step-review-title');
        const body = document.getElementById('step-review-body');

        title.innerHTML = `<i class="fas fa-clipboard-check"></i> Bước ${stepIdx + 1}: ${step.title || ''}`;
        body.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i> Đang tải...</div>';
        overlay.style.display = 'flex';

        if (step.type === 'discussion') {
            renderDiscussionReview(step, body);
        } else if (step.type === 'quiz') {
            renderQuizReview(step, body);
        } else if (step.type === 'homework') {
            renderHomeworkReview(step, body);
        } else {
            body.innerHTML = '<p class="empty-state"><i class="fas fa-check-circle"></i> Hoạt động tổng kết đã hoàn thành</p>';
        }
    });
}

function renderDiscussionReview(step, body) {
    db.ref(`questionBank/discussion/${step.questionId}`).once('value', qSnap => {
        const q = qSnap.val() || {};
        const answers = step.answers || {};
        const evals = step.evaluations || {};
        const answerCount = Object.keys(answers).length;
        const evalCount = Object.keys(evals).length;

        let html = `<div class="sr-section">
            <div class="sr-question-card">
                <div class="sr-q-label"><i class="fas fa-question-circle"></i> Câu hỏi</div>
                <div class="sr-q-title">${q.title || step.title || ''}</div>
                <div class="sr-q-content">${q.content || ''}</div>
                ${q.imageData ? `<div class="sr-q-image"><img src="${q.imageData}" alt="Hình ảnh" onclick="this.classList.toggle('zoomed')"></div>` : ''}
                <div class="sr-q-meta"><i class="fas fa-clock"></i> ${formatTime(q.timeLimit || 0)} &nbsp;|&nbsp; <i class="fas fa-users"></i> ${answerCount} nhóm trả lời &nbsp;|&nbsp; <i class="fas fa-star"></i> ${evalCount} đánh giá</div>
            </div>
        </div>`;

        html += `<div class="sr-section">
            <div class="sr-section-title"><i class="fas fa-inbox"></i> Câu trả lời các nhóm (${answerCount})</div>`;

        if (answerCount === 0) {
            html += '<p class="empty-state"><i class="fas fa-inbox"></i> Không có câu trả lời</p>';
        } else {
            Object.keys(answers).sort().forEach(gName => {
                const a = answers[gName];
                const ev = evals[gName];
                let evalHtml = '';
                if (ev) {
                    evalHtml = `<div class="sr-eval"><span class="sr-eval-stars">${'★'.repeat(ev.stars || 0)}${'☆'.repeat(5 - (ev.stars || 0))}</span> <span class="sr-eval-comment">${ev.comment || ''}</span></div>`;
                }
                let filesHtml = '';
                if (a.files) {
                    a.files.forEach(f => { filesHtml += `<span class="file-tag"><i class="fas fa-file"></i> ${f.name}</span> `; });
                }
                html += `<div class="sr-answer-item">
                    <div class="sr-answer-header">
                        <span class="sr-group-badge">${gName}</span>
                        <span class="sr-time">${a.submittedAt ? new Date(a.submittedAt).toLocaleTimeString('vi') : ''}</span>
                        ${ev ? '<span class="sr-eval-badge">✅ Đã đánh giá</span>' : '<span class="sr-no-eval">⏳ Chưa đánh giá</span>'}
                    </div>
                    <div class="sr-answer-content">${formatAnswerContent(a.content)}</div>
                    ${filesHtml ? `<div class="sr-files">${filesHtml}</div>` : ''}
                    ${evalHtml}
                </div>`;
            });
        }
        html += '</div>';
        body.innerHTML = html;
        renderMathContent(body);
    });
}

function renderQuizReview(step, body) {
    const qIds = step.quizQuestions || [];
    const quizAnswers = step.quizAnswers || {};
    if (qIds.length === 0) { body.innerHTML = '<p class="empty-state">Không có dữ liệu quiz</p>'; return; }

    const promises = qIds.map(id => db.ref(`questionBank/quiz/${id}`).once('value'));
    Promise.all(promises).then(snaps => {
        const questions = snaps.map((s, i) => ({ id: qIds[i], ...s.val() }));

        // Count total groups that participated
        const allGroups = new Set();
        Object.values(quizAnswers).forEach(qAnswers => {
            if (qAnswers) Object.keys(qAnswers).forEach(g => allGroups.add(g));
        });

        let html = `<div class="sr-section">
            <div class="sr-section-title"><i class="fas fa-gamepad"></i> Kết quả trắc nghiệm (${questions.length} câu — ${allGroups.size} nhóm tham gia)</div>`;

        questions.forEach((q, idx) => {
            if (!q || !q.content) return;
            const qId = q.id;
            const qAnswerData = quizAnswers[qId] || {};

            // Classify groups
            let correctGroups = [], wrongGroups = [], groupDetails = [];
            Object.keys(qAnswerData).sort().forEach(gName => {
                const ga = qAnswerData[gName];
                const answer = ga.answer || '—';
                const isCorrect = !!ga.isCorrect;
                if (isCorrect) correctGroups.push(gName);
                else wrongGroups.push(gName);
                groupDetails.push({ gName, answer, isCorrect });
            });

            const typeLabels = { 'multiple-choice': 'Nhiều lựa chọn', 'true-false': 'Đúng/Sai', 'fill-blank': 'Điền khuyết', 'drag-drop': 'Kéo thả' };
            let optionsHtml = '';
            if (q.type === 'multiple-choice' && q.options) {
                const labels = ['A', 'B', 'C', 'D'];
                const opts = Array.isArray(q.options) ? q.options : Object.values(q.options);
                opts.forEach((opt, oi) => {
                    const isCorrect = labels[oi] === q.correct;
                    optionsHtml += `<div class="sr-quiz-option ${isCorrect ? 'correct' : ''}">${labels[oi]}. ${opt} ${isCorrect ? '✅' : ''}</div>`;
                });
            } else if (q.type === 'true-false') {
                optionsHtml = `<div class="sr-quiz-option ${q.correct === 'true' ? 'correct' : ''}">Đúng ${q.correct === 'true' ? '✅' : ''}</div>
                              <div class="sr-quiz-option ${q.correct === 'false' ? 'correct' : ''}">Sai ${q.correct === 'false' ? '✅' : ''}</div>`;
            } else {
                optionsHtml = `<div class="sr-quiz-option correct">Đáp án: ${q.correct} ✅</div>`;
            }

            // Per-group answer detail
            let groupDetailHtml = '';
            if (groupDetails.length > 0) {
                groupDetailHtml = '<div class="sr-group-answers"><div class="sr-group-answers-title"><i class="fas fa-users"></i> Chi tiết từng nhóm:</div>';
                groupDetails.forEach(g => {
                    groupDetailHtml += `<span class="sr-group-chip ${g.isCorrect ? 'correct' : 'wrong'}">${g.gName}: <strong>${g.answer}</strong> ${g.isCorrect ? '✅' : '❌'}</span>`;
                });
                groupDetailHtml += '</div>';
            }

            html += `<div class="sr-quiz-item">
                <div class="sr-quiz-header">
                    <strong>Câu ${idx + 1}:</strong> ${q.content}
                    <span class="sr-quiz-type">${typeLabels[q.type] || q.type}</span>
                </div>
                <div class="sr-quiz-options">${optionsHtml}</div>
                <div class="sr-quiz-stats">
                    <span class="sr-correct"><i class="fas fa-check-circle"></i> ${correctGroups.length} đúng: ${correctGroups.join(', ') || '—'}</span>
                    <span class="sr-wrong"><i class="fas fa-times-circle"></i> ${wrongGroups.length} sai: ${wrongGroups.join(', ') || '—'}</span>
                </div>
                ${groupDetailHtml}
            </div>`;
        });

        html += '</div>';
        body.innerHTML = html;
    });
}

function renderHomeworkReview(step, body) {
    const evals = step.homeworkEvals || {};
    const homeworkId = step.homeworkId;

    // Load teamConfig to get team names/colors
    db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value', tcSnap => {
        const tc = tcSnap.val();
        if (!tc || !tc.teams) {
            body.innerHTML = '<p class="empty-state"><i class="fas fa-users"></i> Chưa cấu hình tổ nhóm</p>';
            return;
        }

        const teamIds = Object.keys(tc.teams);

        // Resolve team tasks from step data or bank
        const resolveFromStep = () => {
            // Try inline teamTasks first
            const inlineTasks = (step.teamTasks || '').split('|').map(s => s.trim()).filter(Boolean);
            if (inlineTasks.length > 0) return Promise.resolve(inlineTasks);

            // Then try questionBank via homeworkId
            if (homeworkId) {
                return db.ref(`questionBank/homework/${homeworkId}`).once('value').then(snap => {
                    const data = snap.val();
                    return (data && data.teamTasks) ? data.teamTasks.split('|').map(s => s.trim()) : [];
                });
            }

            // Last resort: latest bank entry
            return db.ref('questionBank/homework').limitToLast(1).once('value').then(snap => {
                const bank = snap.val() || {};
                const key = Object.keys(bank)[0];
                return (key && bank[key].teamTasks) ? bank[key].teamTasks.split('|').map(s => s.trim()) : [];
            });
        };

        resolveFromStep().then(teamTasks => {
            const evalCount = Object.keys(evals).length;

            // Header card
            let html = `<div class="sr-section">
                <div class="sr-question-card">
                    <div class="sr-q-label"><i class="fas fa-home" style="color:#f5af19"></i> Nhiệm vụ về nhà</div>
                    <div class="sr-q-title">${step.title || 'Nhiệm vụ về nhà'}</div>
                    <div class="sr-q-meta">
                        <i class="fas fa-users"></i> ${teamIds.length} tổ &nbsp;|&nbsp;
                        <i class="fas fa-star"></i> ${evalCount} tổ đã có đánh giá &nbsp;|&nbsp;
                        <i class="fas fa-clock"></i> ${step.completedAt ? new Date(step.completedAt).toLocaleString('vi') : ''}
                    </div>
                </div>
            </div>`;

            // Team tasks overview
            html += `<div class="sr-section">
                <div class="sr-section-title"><i class="fas fa-clipboard-list"></i> Nhiệm vụ các tổ</div>
                <div class="sr-hw-tasks">`;
            teamIds.forEach((tid, idx) => {
                const t = tc.teams[tid];
                const task = teamTasks[idx] || '';
                html += `<div class="sr-hw-task-item">
                    <span class="hw-team-dot" style="background:${t.color}"></span>
                    <strong>${t.name}:</strong>
                    <span>${task || '<em style="opacity:0.4">(chưa gán)</em>'}</span>
                </div>`;
            });
            html += '</div></div>';

            // Score matrix
            html += `<div class="sr-section">
                <div class="sr-section-title"><i class="fas fa-table"></i> Bảng điểm đánh giá</div>
                <div class="hw-matrix-scroll" id="sr-hw-matrix-container"></div>
            </div>`;

            // Per-team evaluation details
            html += `<div class="sr-section">
                <div class="sr-section-title"><i class="fas fa-comments"></i> Chi tiết đánh giá từng tổ</div>`;

            if (evalCount === 0) {
                html += '<p class="empty-state"><i class="fas fa-inbox"></i> Chưa có đánh giá nào</p>';
            } else {
                teamIds.forEach((tid, idx) => {
                    const t = tc.teams[tid];
                    const teamEval = evals[tid] || {};
                    const evalEntries = Object.entries(teamEval);

                    if (evalEntries.length === 0) {
                        html += `<div class="sr-answer-item">
                            <div class="sr-answer-header">
                                <span class="sr-group-badge" style="background:${t.color}">${t.name}</span>
                                <span class="sr-no-eval">⏳ Chưa có đánh giá</span>
                            </div>
                        </div>`;
                        return;
                    }

                    let totalScore = 0, count = 0;
                    let evalsHtml = '';
                    evalEntries.forEach(([evalBy, ev]) => {
                        const isTeacher = evalBy === 'teacher';
                        const evalName = isTeacher ? '👑 Giáo viên' : (tc.teams[evalBy] ? tc.teams[evalBy].name : evalBy);
                        const evalColor = isTeacher ? '#ffd700' : (tc.teams[evalBy] ? tc.teams[evalBy].color : '#888');
                        evalsHtml += `<div class="sr-eval-detail">
                            <span class="sr-eval-by" style="color:${evalColor}">${evalName}</span>
                            <span class="sr-eval-score">${ev.score}/10</span>
                            ${ev.comment ? `<span class="sr-eval-comment">${ev.comment}</span>` : ''}
                        </div>`;
                        totalScore += ev.score;
                        count++;
                    });

                    const avg = count > 0 ? (totalScore / count).toFixed(2) : '--';
                    html += `<div class="sr-answer-item">
                        <div class="sr-answer-header">
                            <span class="sr-group-badge" style="background:${t.color}">${t.name}</span>
                            <span class="sr-eval-badge">Điểm TB: <strong>${avg}</strong></span>
                        </div>
                        <div class="sr-answer-content">${evalsHtml}</div>
                    </div>`;
                });
            }
            html += '</div>';

            body.innerHTML = html;

            // Render the matrix table into the container
            const matrixContainer = document.getElementById('sr-hw-matrix-container');
            if (matrixContainer) {
                renderScoreMatrixTable(matrixContainer, tc, evals, teamIds, teamTasks);
            }
        });
    });
}

// Close handler
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('btn-close-step-review');
    if (closeBtn) closeBtn.addEventListener('click', () => {
        document.getElementById('step-review-overlay').style.display = 'none';
    });
});


function switchToPanel(panelId) {
    // New layout (.td-panel, .td-nav-btn)
    document.querySelectorAll('.td-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.td-nav-btn').forEach(m => m.classList.remove('active'));
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.add('active');
    // Activate matching nav button by data-panel attribute
    const navBtn = document.querySelector(`.td-nav-btn[data-panel="${panelId}"]`);
    if (navBtn) navBtn.classList.add('active');
}

/* --- Activity View: render content inline in Dạy học tab --- */
function showActivityView(type) {
    // Hide all activity containers
    const views = ['discussion', 'quiz', 'summary', 'homework'];
    views.forEach(v => {
        const el = document.getElementById(`activity-${v}-view`);
        if (el) el.style.display = 'none';
    });
    const idle = document.getElementById('activity-view-idle');
    if (idle) idle.style.display = 'none';
    const activityView = document.getElementById('activity-view');

    if (type === 'hide') {
        // Ẩn toàn bộ activity view + reset trạng thái UI
        if (activityView) activityView.style.display = 'none';
        // Reset discussion UI
        const discSend = document.getElementById('disc-send-area');
        if (discSend) discSend.style.display = 'none';
        const discAnswers = document.getElementById('disc-answers-area');
        if (discAnswers) discAnswers.style.display = 'none';
        const timerCtrl = document.getElementById('timer-controls');
        if (timerCtrl) timerCtrl.style.display = 'none';
        const btnSend = document.getElementById('btn-send-discussion');
        if (btnSend) btnSend.style.display = '';
        const btnStop = document.getElementById('btn-stop-discussion');
        if (btnStop) btnStop.style.display = 'none';
        // Reset quiz UI
        const quizSetup = document.getElementById('quiz-setup-area');
        if (quizSetup) quizSetup.style.display = 'none';
        const quizControl = document.getElementById('quiz-control-area');
        if (quizControl) quizControl.style.display = 'none';
        const quizRanking = document.getElementById('quiz-ranking-area');
        if (quizRanking) quizRanking.style.display = 'none';
        stopTeacherRankingListener();
        // Reset homework UI
        const hwEval = document.getElementById('hw-teacher-eval');
        if (hwEval) hwEval.style.display = 'none';
    } else if (type === 'idle') {
        if (activityView) activityView.style.display = '';
        if (idle) idle.style.display = '';
    } else if (type === 'discussion') {
        if (activityView) activityView.style.display = '';
        const target = document.getElementById('activity-discussion-view');
        if (target) target.style.display = '';
    } else if (type === 'quiz') {
        if (activityView) activityView.style.display = '';
        const target = document.getElementById('activity-quiz-view');
        if (target) target.style.display = '';
        const quizSetup = document.getElementById('quiz-setup-area');
        if (quizSetup) quizSetup.style.display = 'none';
        const quizControl = document.getElementById('quiz-control-area');
        if (quizControl) quizControl.style.display = '';
        const quizRanking = document.getElementById('quiz-ranking-area');
        if (quizRanking) quizRanking.style.display = '';
    } else if (type === 'homework') {
        if (activityView) activityView.style.display = '';
        const target = document.getElementById('activity-homework-view');
        if (target) target.style.display = '';
        document.getElementById('btn-stop-homework').style.display = '';
    } else if (type === 'summary') {
        if (activityView) activityView.style.display = '';
        const target = document.getElementById('activity-summary-view');
        if (target) target.style.display = '';
    }
    // Always stay on Teach tab
    switchToPanel('panel-teach');
}

/* --- Student: Listen for lesson plan status --- */
function initStudentLessonListener() {
    db.ref(`rooms/${STATE.roomId}/lessonPlan`).on('value', snap => {
        const lp = snap.val();
        if (!lp || !lp.isActive) return;
        // Update student's group badge with current step info
        const step = lp.steps && lp.steps[lp.currentStep || 0];
        if (step) {
            const badge = document.getElementById('disc-student-group') || document.getElementById('quiz-student-group');
            if (badge) {
                const stepLabel = `Bước ${(lp.currentStep || 0) + 1}/${lp.totalSteps}: ${step.title}`;
                badge.title = stepLabel;
            }
        }
    });
}

/* === 12B. START STEP CONFIRM + COUNTDOWN === */


/* GV: Hiện overlay online/offline trước khi bắt đầu hoạt động */
function showStartStepConfirm(title, callback) {
    const overlay = document.getElementById('start-step-overlay');
    document.getElementById('start-step-title').textContent = title;
    overlay.style.display = '';

    // Lắng nghe real-time trạng thái nhóm
    const listener = db.ref(`rooms/${STATE.roomId}/groups`).on('value', snap => {
        const groups = snap.val() || {};
        let onCount = 0;
        const grid = document.getElementById('start-step-groups');
        grid.innerHTML = '';
        for (let i = 1; i <= TOTAL_GROUPS; i++) {
            const g = groups[`nhom-${i}`];
            const on = g && g.online;
            if (on) onCount++;
            grid.innerHTML += `<div class="oss-item ${on ? 'online' : 'offline'}">
                <span class="oss-num">${i}</span>
                <span class="oss-name">${g && g.members ? g.members[0] : '—'}</span>
            </div>`;
        }
        document.getElementById('start-step-summary').innerHTML =
            `<span style="color:var(--success)">${onCount} online</span> / <span style="color:var(--danger)">${TOTAL_GROUPS - onCount} offline</span>`;
    });

    document.getElementById('btn-start-step-now').onclick = () => {
        db.ref(`rooms/${STATE.roomId}/groups`).off('value', listener);
        overlay.style.display = 'none';
        // Gửi countdown signal cho HS rồi thực thi callback
        startActivityCountdown(title, callback);
    };
    document.getElementById('btn-start-step-cancel').onclick = () => {
        db.ref(`rooms/${STATE.roomId}/groups`).off('value', listener);
        overlay.style.display = 'none';
    };
}

/* Gửi countdown 3-2-1 qua Firebase, sau 3.5s gọi callback */
function startActivityCountdown(title, callback) {
    db.ref(`rooms/${STATE.roomId}/countdown`).set({
        active: true,
        title: title,
        startedAt: Date.now()
    });
    // GV đợi 4.2 giây (HS đếm 3-2-1 + buffer cho Firebase latency) [BUG 10]
    setTimeout(() => {
        db.ref(`rooms/${STATE.roomId}/countdown`).remove();
        callback();
    }, 4200);
}

/* HS: Lắng nghe countdown signal từ GV */
function initStudentCountdownListener() {
    db.ref(`rooms/${STATE.roomId}/countdown`).on('value', snap => {
        const cd = snap.val();
        const overlay = document.getElementById('activity-countdown-overlay');
        if (!cd || !cd.active) {
            overlay.style.display = 'none';
            return;
        }
        // Hiện overlay + đếm 3-2-1
        document.getElementById('acd-activity-name').textContent = cd.title || 'Hoạt động tiếp theo';
        overlay.style.display = '';
        let count = 3;
        const numEl = document.getElementById('acd-number');
        numEl.textContent = count;
        numEl.style.animation = 'countdownPulse 0.8s ease';

        clearInterval(STATE.countdownInterval);
        STATE.countdownInterval = setInterval(() => {
            count--;
            if (count > 0) {
                numEl.textContent = count;
                numEl.style.animation = 'none';
                void numEl.offsetHeight; // reflow
                numEl.style.animation = 'countdownPulse 0.8s ease';
            } else {
                numEl.textContent = '🚀';
                numEl.style.animation = 'none';
                void numEl.offsetHeight;
                numEl.style.animation = 'countdownPulse 0.8s ease';
                clearInterval(STATE.countdownInterval);
                setTimeout(() => { overlay.style.display = 'none'; }, 700);
            }
        }, 1000);
    });
}

/* === 13. INIT === */

/* Cleanup student Firebase listeners to prevent memory leaks */
function cleanupStudentListeners() {
    const base = `rooms/${STATE.roomId}`;
    db.ref(`${base}/countdown`).off();
    db.ref(`${base}/reactions`).off();
    db.ref(`${base}/groups`).off();
    db.ref(`${base}/status`).off();
    db.ref(`${base}/currentQuestion`).off();
    db.ref(`${base}/timer`).off();
    db.ref(`${base}/answers`).off();
    db.ref(`${base}/peerReviews`).off();
    db.ref(`${base}/evaluations/nhom-${STATE.groupNumber}`).off();
    db.ref(`${base}/quizState`).off();
    db.ref(`${base}/currentQuizQuestion`).off();
    db.ref(`${base}/groups/nhom-${STATE.groupNumber}/score`).off();
    db.ref(`${base}/homeworkState`).off();
    db.ref(`${base}/homeworkEvals`).off();
    clearInterval(STATE.timerInterval);
    clearInterval(STATE.finalReturnInterval);
    clearTimeout(STATE.quizLeaderboardTimeout);
    clearInterval(STATE.submittedCountdownInterval);
    clearInterval(STATE.countdownInterval);
}

document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    restoreSession();
    // [FIX B12] Chỉ lắng nghe quizState khi đã có role, tránh listener thừa
    // Quiz question counter sẽ được cập nhật trong initQuizStudent/initQuizTeacher tương ứng
    // Giữ listener nhẹ — chỉ update nếu element tồn tại
    db.ref(`rooms/${STATE.roomId}/quizState`).on('value', snap => {
        const qs = snap.val();
        if (!qs) return;
        // Chỉ update element nào tồn tại trên DOM hiện tại (tùy role)
        const text = `Câu ${(qs.currentIndex || 0) + 1}/${qs.total || 0}`;
        const teacherEl = document.getElementById('teacher-quiz-question-counter');
        const studentEl = document.getElementById('quiz-question-counter');
        if (STATE.role === 'teacher' && teacherEl) teacherEl.textContent = text;
        else if (STATE.role === 'student' && studentEl) studentEl.textContent = text;
    });
    // HS: Lắng nghe countdown
    initStudentCountdownListener();
    // Lesson Plan Engine
    initLessonPlanBuilder();
    initStudentLessonListener();
});

/* ===========================================================
   14. TEAM MANAGER MODULE
   GV tạo/quản lý tổ học sinh
   =========================================================== */
function initTeamManager() {
    let selectedCount = 4;
    const toggleEl = document.getElementById('team-mode-toggle');
    const configBody = document.getElementById('team-config-body');
    const statusLabel = document.getElementById('team-toggle-status');

    // Toggle handler
    toggleEl.addEventListener('change', () => {
        const isOn = toggleEl.checked;
        configBody.style.display = isOn ? '' : 'none';
        statusLabel.textContent = isOn ? 'Bật' : 'Tắt';
        statusLabel.style.color = isOn ? '#38ef7d' : 'rgba(255,255,255,0.4)';
        // Save enabled state to Firebase immediately
        db.ref(`rooms/${STATE.roomId}/teamConfig/enabled`).set(isOn);
        if (!isOn) {
            showToast('Đã tắt chế độ tổ — HS đăng nhập bình thường', 'info');
        } else {
            showToast('Đã bật chế độ tổ — HS sẽ chọn Tổ + Vai trò', 'success');
        }
    });

    // Count buttons
    document.querySelectorAll('#team-count-selector .team-count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#team-count-selector .team-count-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCount = parseInt(btn.dataset.count);
            document.getElementById('team-custom-count').value = '';
            renderTeamNameInputs(selectedCount);
        });
    });
    document.getElementById('team-custom-count').addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        if (v >= 2 && v <= 9) {
            document.querySelectorAll('#team-count-selector .team-count-btn').forEach(b => b.classList.remove('active'));
            selectedCount = v;
            renderTeamNameInputs(v);
        }
    });

    function renderTeamNameInputs(count) {
        const list = document.getElementById('team-names-list');
        let html = '';
        for (let i = 1; i <= count; i++) {
            const color = TEAM_COLORS[(i - 1) % TEAM_COLORS.length];
            html += `<div class="team-name-row">
                <span class="team-color-dot" style="background:${color}"></span>
                <input type="text" class="team-name-input" id="team-name-${i}" value="Tổ ${i}" placeholder="Tên tổ ${i}">
            </div>`;
        }
        list.innerHTML = html;
    }
    renderTeamNameInputs(selectedCount);

    // Save
    document.getElementById('btn-save-teams').addEventListener('click', () => {
        const teams = {};
        for (let i = 1; i <= selectedCount; i++) {
            const nameInput = document.getElementById(`team-name-${i}`);
            teams[`to-${i}`] = {
                name: nameInput ? nameInput.value.trim() || `Tổ ${i}` : `Tổ ${i}`,
                color: TEAM_COLORS[(i - 1) % TEAM_COLORS.length]
            };
        }
        db.ref(`rooms/${STATE.roomId}/teamConfig`).set({
            totalTeams: selectedCount, teams,
            enabled: toggleEl.checked
        });
        showToast(`Đã lưu ${selectedCount} tổ!`, 'success');
    });

    // Load existing config
    db.ref(`rooms/${STATE.roomId}/teamConfig`).on('value', snap => {
        const tc = snap.val();
        if (!tc) return;
        // Reflect toggle state
        const isEnabled = tc.enabled === true;
        toggleEl.checked = isEnabled;
        configBody.style.display = isEnabled ? '' : 'none';
        statusLabel.textContent = isEnabled ? 'Bật' : 'Tắt';
        statusLabel.style.color = isEnabled ? '#38ef7d' : 'rgba(255,255,255,0.4)';

        selectedCount = tc.totalTeams || 4;
        // Highlight correct button
        document.querySelectorAll('#team-count-selector .team-count-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.count) === selectedCount);
        });
        renderTeamNameInputs(selectedCount);
        if (tc.teams) {
            Object.entries(tc.teams).forEach(([id, t]) => {
                const idx = parseInt(id.replace('to-', ''));
                const inp = document.getElementById(`team-name-${idx}`);
                if (inp) inp.value = t.name;
            });
        }
        // Live status: hiện HS nào thuộc tổ nào
        renderTeamLiveStatus(tc);
    });

    function renderTeamLiveStatus(tc) {
        db.ref(`rooms/${STATE.roomId}/groups`).once('value', snap => {
            const groups = snap.val() || {};
            const container = document.getElementById('team-live-status');
            if (!tc || !tc.teams) { container.innerHTML = ''; return; }
            let html = '<div class="team-live-grid">';
            Object.entries(tc.teams).forEach(([tid, t]) => {
                const members = Object.entries(groups)
                    .filter(([_, g]) => g.teamId === tid && g.online)
                    .map(([k, g]) => {
                        const isLeader = g.teamRole === 'leader';
                        return `<span class="team-member ${isLeader ? 'leader' : ''}">${isLeader ? '👑 ' : ''}${g.members?.[0] || k}</span>`;
                    });
                html += `<div class="team-live-card" style="border-left:3px solid ${t.color}">
                    <div class="team-live-name" style="color:${t.color}">${t.name}</div>
                    <div class="team-live-members">${members.length > 0 ? members.join('') : '<span class="empty-state" style="font-size:11px">(chưa có)</span>'}</div>
                </div>`;
            });
            html += '</div>';
            container.innerHTML = html;
        });
    }
}

/* ===========================================================
   15. HOMEWORK TEACHER MODULE
   GV điều khiển hoạt động nhiệm vụ về nhà
   =========================================================== */
function initHomeworkTeacher() {
    // Stop homework
    document.getElementById('btn-stop-homework').addEventListener('click', () => {
        if (!confirm('Kết thúc nhiệm vụ về nhà?')) return;
        db.ref(`rooms/${STATE.roomId}/homeworkState`).once('value', snap => {
            const hw = snap.val();
            if (hw && hw.stepIdx !== undefined) lpStopStep(hw.stepIdx);
            db.ref(`rooms/${STATE.roomId}/homeworkState`).update({ active: false, phase: 'ended' });
        });
    });
    // Note: teacher eval form is now rendered dynamically by renderTeacherActionBar()
}

// Custom confirmation dialog for homework actions
function showHwConfirm(title, message, accentColor, onConfirm) {
    // Remove any existing dialog
    const existing = document.getElementById('hw-confirm-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hw-confirm-overlay';
    overlay.className = 'hw-confirm-overlay';
    overlay.innerHTML = `
        <div class="hw-confirm-dialog" style="--accent:${accentColor || '#667eea'}">
            <div class="hw-confirm-title">${title}</div>
            <div class="hw-confirm-msg">${message}</div>
            <div class="hw-confirm-buttons">
                <button class="hw-confirm-btn cancel" id="hw-confirm-cancel">
                    <i class="fas fa-times"></i> Hủy
                </button>
                <button class="hw-confirm-btn ok" id="hw-confirm-ok" style="background:${accentColor || '#667eea'}">
                    <i class="fas fa-check"></i> Xác nhận
                </button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const close = () => {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 200);
    };

    document.getElementById('hw-confirm-cancel').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('hw-confirm-ok').onclick = () => {
        close();
        onConfirm();
    };
}

// Shared helper: resolve teamTasks from multiple sources
// Priority: 1) homeworkState.teamTasks, 2) questionBank via homeworkId, 3) latest bank entry
function resolveTeamTasks(hw, callback) {
    const rawTasks = hw.teamTasks || [];
    const hasContent = Array.isArray(rawTasks) && rawTasks.some(t => t && t.trim());

    if (hasContent) {
        callback(rawTasks);
    } else if (hw.homeworkId) {
        db.ref(`questionBank/homework/${hw.homeworkId}`).once('value', snap => {
            const data = snap.val();
            callback((data && data.teamTasks) ? data.teamTasks.split('|').map(s => s.trim()) : []);
        });
    } else {
        db.ref('questionBank/homework').limitToLast(1).once('value', snap => {
            const bank = snap.val() || {};
            const key = Object.keys(bank)[0];
            callback((key && bank[key].teamTasks) ? bank[key].teamTasks.split('|').map(s => s.trim()) : []);
        });
    }
}

function renderHomeworkTeacherView(tc) {
    const tabs = document.getElementById('hw-team-tabs');
    if (!tc || !tc.teams) return;

    // Listen to homeworkState for real-time phase updates
    db.ref(`rooms/${STATE.roomId}/homeworkState`).off('value', STATE._hwTeacherListener);
    STATE._hwTeacherListener = db.ref(`rooms/${STATE.roomId}/homeworkState`).on('value', hwSnap => {
        const hw = hwSnap.val() || {};
        const presenting = hw.presentingTeam;
        const phase = hw.phase || 'waiting';
        const completedTeams = hw.completedTeams || {};

        // Resolve teamTasks via shared helper
        resolveTeamTasks(hw, (teamTasks) => {
            tabs.innerHTML = '';
            Object.entries(tc.teams).forEach(([tid, t], idx) => {
                const task = teamTasks[idx] || '';
                const isPresenting = presenting === tid && phase === 'presenting';
                const isEvaluating = presenting === tid && phase === 'evaluating';
                const isDone = completedTeams[tid] === true;

                const btn = document.createElement('button');
                btn.className = `hw-team-tab ${isPresenting ? 'presenting' : ''} ${isEvaluating ? 'evaluating' : ''} ${isDone ? 'done' : ''}`;
                btn.style.borderColor = t.color;

                let statusTag = '';
                if (isPresenting) statusTag = '<span class="hw-tab-status presenting"><i class="fas fa-microphone"></i> Đang trình bày</span>';
                else if (isEvaluating) statusTag = '<span class="hw-tab-status evaluating"><i class="fas fa-star"></i> Đang đánh giá</span>';
                else if (isDone) statusTag = '<span class="hw-tab-status done"><i class="fas fa-check"></i> Hoàn thành</span>';

                btn.innerHTML = `<div class="hw-tab-main">
                    <span class="hw-tab-dot" style="background:${t.color}"></span>
                    <span class="hw-tab-name">${t.name}</span>
                    ${statusTag}
                </div>
                ${task ? `<div class="hw-tab-task"><i class="fas fa-clipboard-list"></i> ${task}</div>` : ''}`;

                btn.onclick = () => {
                    // Đang trình bày hoặc đánh giá tổ này → bỏ qua
                    if (isPresenting || isEvaluating) return;

                    // Nếu đang trong phase evaluating tổ khác → xác nhận chuyển
                    if (phase === 'evaluating' && presenting && presenting !== tid) {
                        const curTeam = tc.teams[presenting];
                        showHwConfirm(
                            `⚠️ Chuyển tổ trình bày`,
                            `Đang đánh giá <strong>${curTeam ? curTeam.name : presenting}</strong>. Bạn muốn chuyển sang <strong style="color:${t.color}">${t.name}</strong> trình bày?`,
                            t.color,
                            () => {
                                db.ref(`rooms/${STATE.roomId}/homeworkState`).update({ presentingTeam: tid, phase: 'presenting', [`completedTeams/${presenting}`]: true });
                                showToast(`Chuyển sang ${t.name} trình bày!`, 'success');
                            }
                        );
                        return;
                    }

                    // Bình thường: xác nhận chọn tổ trình bày
                    showHwConfirm(
                        `🎤 Chọn tổ trình bày`,
                        `Bạn muốn cho <strong style="color:${t.color}">${t.name}</strong> lên trình bày?${task ? '<br><small style="opacity:0.7">Nhiệm vụ: ' + task + '</small>' : ''}`,
                        t.color,
                        () => {
                            db.ref(`rooms/${STATE.roomId}/homeworkState`).update({ presentingTeam: tid, phase: 'presenting' });
                            showToast(`${t.name} bắt đầu trình bày!`, 'success');
                        }
                    );
                };
                tabs.appendChild(btn);
            });

            // Render action bar for current presenting team
            renderTeacherActionBar(tc, hw);
        });
    });

    // Listen for eval submissions + render matrix
    db.ref(`rooms/${STATE.roomId}/homeworkEvals`).off();
    db.ref(`rooms/${STATE.roomId}/homeworkEvals`).on('value', snap => {
        const evals = snap.val() || {};
        renderEvalStatus(tc, evals);
        renderScoreMatrix(tc, evals, 'hw-matrix-scroll');
    });
}

// Render action bar based on current phase
function renderTeacherActionBar(tc, hw) {
    const presenting = hw.presentingTeam;
    const phase = hw.phase || 'waiting';
    const evalArea = document.getElementById('hw-teacher-eval');

    if (!presenting || phase === 'waiting') {
        evalArea.style.display = 'none';
        return;
    }

    const t = tc.teams[presenting];
    if (!t) return;

    if (phase === 'presenting') {
        // Đang trình bày → hiện nút "Kết thúc trình bày"
        evalArea.style.display = '';
        evalArea.innerHTML = `<div class="glass-card hw-action-card">
            <div class="hw-action-header">
                <span class="hw-action-icon" style="background:${t.color}">🎤</span>
                <div>
                    <h4 style="margin:0">${t.name} đang trình bày</h4>
                    <p style="margin:4px 0 0;font-size:13px;opacity:0.6">Khi tổ trình bày xong, nhấn "Kết thúc" để các tổ khác đánh giá</p>
                </div>
            </div>
            <button class="btn-warning hw-btn-finish-present" id="btn-hw-finish-present">
                <i class="fas fa-check-circle"></i> Kết thúc trình bày → Bắt đầu đánh giá
            </button>
        </div>`;
        document.getElementById('btn-hw-finish-present').onclick = () => {
            showHwConfirm(
                `✅ Kết thúc trình bày`,
                `<strong style="color:${t.color}">${t.name}</strong> đã trình bày xong?<br>Các tổ khác sẽ bắt đầu đánh giá.`,
                t.color,
                () => {
                    db.ref(`rooms/${STATE.roomId}/homeworkState`).update({ phase: 'evaluating' });
                    showToast(`${t.name} kết thúc trình bày — các tổ bắt đầu đánh giá!`, 'success');
                }
            );
        };
    } else if (phase === 'evaluating') {
        // Đang đánh giá → hiện form chấm điểm GV + nút hoàn thành
        evalArea.style.display = '';
        evalArea.innerHTML = `<div class="glass-card hw-action-card">
            <div class="hw-action-header">
                <span class="hw-action-icon evaluating">⭐</span>
                <div>
                    <h4 style="margin:0">Đánh giá ${t.name}</h4>
                    <p style="margin:4px 0 0;font-size:13px;opacity:0.6">Các tổ khác đang đánh giá. GV cũng cho điểm:</p>
                </div>
            </div>
            <div class="hw-eval-row">
                <label>Điểm (1-10):</label>
                <input type="range" id="hw-teacher-score" min="1" max="10" value="7" step="0.5">
                <span class="hw-score-num" id="hw-teacher-score-display">7</span>
            </div>
            <div class="form-group">
                <textarea id="hw-teacher-comment" rows="2" placeholder="Nhận xét của giáo viên..."></textarea>
            </div>
            <div class="hw-action-buttons">
                <button class="btn-primary" id="btn-hw-teacher-submit-eval">
                    <i class="fas fa-check"></i> Gửi đánh giá GV
                </button>
                <button class="btn-success" id="btn-hw-complete-team">
                    <i class="fas fa-forward"></i> Hoàn thành → Chọn tổ tiếp
                </button>
            </div>
        </div>`;

        // Score slider handler
        document.getElementById('hw-teacher-score').oninput = function() {
            document.getElementById('hw-teacher-score-display').textContent = this.value;
        };
        // Submit teacher eval
        document.getElementById('btn-hw-teacher-submit-eval').onclick = () => {
            const score = parseFloat(document.getElementById('hw-teacher-score').value);
            const comment = (document.getElementById('hw-teacher-comment')?.value || '').trim();
            db.ref(`rooms/${STATE.roomId}/homeworkEvals/${presenting}/teacher`).set({
                score, comment, at: Date.now()
            });
            showToast('Đã gửi đánh giá GV!', 'success');
        };
        // Complete this team → mark done, reset to waiting for next
        document.getElementById('btn-hw-complete-team').onclick = () => {
            showHwConfirm(
                `🏁 Hoàn thành đánh giá`,
                `Kết thúc đánh giá <strong style="color:${t.color}">${t.name}</strong>?<br>Bạn có thể chọn tổ tiếp theo trình bày.`,
                t.color,
                () => {
                    db.ref(`rooms/${STATE.roomId}/homeworkState`).update({
                        presentingTeam: null,
                        phase: 'waiting',
                        [`completedTeams/${presenting}`]: true
                    });
                    evalArea.style.display = 'none';
                    showToast(`${t.name} đã hoàn thành! Chọn tổ tiếp theo.`, 'success');
                }
            );
        };
    }
}

function renderEvalStatus(tc, evals) {
    const container = document.getElementById('hw-eval-status');
    if (!tc || !container) return;
    let html = '<div class="hw-eval-chips">';
    Object.entries(tc.teams).forEach(([tid, t]) => {
        const teamEvals = evals[tid] || {};
        const evalCount = Object.keys(teamEvals).length;
        const totalExpected = Object.keys(tc.teams).length; // other teams + teacher
        html += `<div class="hw-eval-chip" style="border-color:${t.color}">
            <span style="color:${t.color}">${t.name}</span>
            <span class="hw-eval-count">${evalCount}/${totalExpected} đánh giá</span>
        </div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}

/* ===========================================================
   16. SCORE MATRIX TABLE
   Bảng tổng hợp điểm đánh giá chéo
   =========================================================== */
function renderScoreMatrix(tc, evals, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !tc || !tc.teams) return;

    const teamIds = Object.keys(tc.teams);

    // Fetch homework state, then resolve tasks via shared helper
    db.ref(`rooms/${STATE.roomId}/homeworkState`).once('value', snap => {
        const hw = snap.val() || {};
        resolveTeamTasks(hw, (teamTasks) => {
            renderScoreMatrixTable(container, tc, evals, teamIds, teamTasks);
        });
    });
}

function renderScoreMatrixTable(container, tc, evals, teamIds, teamTasks) {
        let html = '<table class="hw-score-table">';
        // Header row
        html += '<thead><tr>';
        html += '<th class="hw-th-team">Tổ trình bày</th>';
        html += '<th class="hw-th-task">Nội dung nhiệm vụ</th>';
        teamIds.forEach(tid => {
            const t = tc.teams[tid];
            html += `<th class="hw-th-eval" style="color:${t.color}"><span class="hw-th-dot" style="background:${t.color}"></span>${t.name}<br><small>đ.ánh giá</small></th>`;
        });
        html += '<th class="hw-th-teacher"><i class="fas fa-crown" style="color:#ffd700"></i> GV</th>';
        html += '<th class="hw-th-total">Tổng điểm</th>';
        html += '</tr></thead><tbody>';

        // Data rows
        const scores = {};
        teamIds.forEach((tid, rowIdx) => {
            const t = tc.teams[tid];
            const teamEval = evals[tid] || {};
            const taskText = teamTasks[rowIdx] || '';
            html += `<tr class="hw-row" style="--team-color:${t.color}">`;
            html += `<td class="hw-td-team"><span class="hw-team-dot" style="background:${t.color}"></span>${t.name}</td>`;
            html += `<td class="hw-td-task">${taskText || '<em style="opacity:0.4">(chưa gán)</em>'}</td>`;

            let totalScore = 0;
            let countScores = 0;

            teamIds.forEach(evalTid => {
                if (evalTid === tid) {
                    html += '<td class="hw-td-self">&mdash;</td>';
                } else {
                    const ev = teamEval[evalTid];
                    if (ev) {
                        html += `<td class="hw-td-score has-score" title="${ev.comment || ''}"><span class="hw-score-val">${ev.score}</span>${ev.comment ? '<br><small class="hw-score-comment">' + ev.comment.substring(0, 30) + '</small>' : ''}</td>`;
                        totalScore += ev.score;
                        countScores++;
                    } else {
                        html += '<td class="hw-td-score waiting"><i class="fas fa-hourglass-half"></i></td>';
                    }
                }
            });

            // Teacher score
            const teacherEval = teamEval.teacher;
            if (teacherEval) {
                html += `<td class="hw-td-teacher has-score"><span class="hw-score-val">${teacherEval.score}</span>${teacherEval.comment ? '<br><small class="hw-score-comment">' + teacherEval.comment.substring(0, 30) + '</small>' : ''}</td>`;
                totalScore += teacherEval.score;
                countScores++;
            } else {
                html += '<td class="hw-td-teacher waiting"><i class="fas fa-hourglass-half"></i></td>';
            }

            // Total
            const avg = countScores > 0 ? (totalScore / countScores).toFixed(2) : '--';
            scores[tid] = countScores > 0 ? parseFloat(avg) : 0;
            html += `<td class="hw-td-total"><span class="hw-total-num">${avg}</span></td>`;
            html += '</tr>';
        });

        html += '</tbody></table>';

        // Ranking footer
        const ranked = teamIds
            .map(tid => ({ tid, name: tc.teams[tid].name, color: tc.teams[tid].color, score: scores[tid] }))
            .sort((a, b) => b.score - a.score);
        const medals = ['🥇', '🥈', '🥉'];
        html += '<div class="hw-ranking-footer">';
        ranked.forEach((r, i) => {
            html += `<span class="hw-rank-item" style="border-color:${r.color}">${i < 3 ? medals[i] : (i + 1) + '.'} ${r.name}: <strong>${r.score || '--'}</strong></span>`;
        });
        html += '</div>';

        container.innerHTML = html;
}

/* ===========================================================
   17. HOMEWORK STUDENT MODULE
   HS tham gia hoạt động nhiệm vụ về nhà
   =========================================================== */
function initHomeworkStudent() {
    const hasTeam = !!STATE.teamId;

    if (!hasTeam) {
        // HS chưa chọn tổ — observer mode (chỉ xem, không đánh giá)
        document.getElementById('hw-presenting-own').style.display = 'none';
        document.getElementById('hw-leader-eval').style.display = 'none';
        document.getElementById('hw-role-badge').textContent = 'Quan sát';
        document.getElementById('hw-student-team').textContent = 'Không có tổ';
        document.getElementById('hw-student-name').textContent = STATE.studentName || 'HS';
    }

    // Set header info (only if has team)
    if (hasTeam) {
        db.ref(`rooms/${STATE.roomId}/teamConfig/teams/${STATE.teamId}`).once('value', snap => {
            const t = snap.val();
            if (t) {
                document.getElementById('hw-student-team').textContent = t.name;
                document.getElementById('hw-student-team').style.background = t.color;
            }
        });
        document.getElementById('hw-role-badge').textContent = STATE.teamRole === 'leader' ? '👑 Tổ trưởng' : 'Thành viên';
        document.getElementById('hw-student-name').textContent = STATE.studentName;
    }

    // Score slider
    const scoreSlider = document.getElementById('hw-eval-score');
    if (scoreSlider) {
        scoreSlider.oninput = () => {
            document.getElementById('hw-score-display').textContent = scoreSlider.value;
        };
    }

    // Submit eval (leader only)
    document.getElementById('btn-hw-submit-eval').onclick = () => {
        const presentingTeam = document.getElementById('hw-eval-target-name').dataset.teamId;
        if (!presentingTeam) return;
        const score = parseFloat(document.getElementById('hw-eval-score').value);
        const comment = document.getElementById('hw-eval-comment').value.trim();
        db.ref(`rooms/${STATE.roomId}/homeworkEvals/${presentingTeam}/${STATE.teamId}`).set({
            score, comment, by: STATE.studentName, at: Date.now()
        });
        document.getElementById('hw-eval-submitted').style.display = '';
        document.getElementById('btn-hw-submit-eval').disabled = true;
        showToast('Đã gửi đánh giá!', 'success');
    };

    // Listen to homework state changes
    db.ref(`rooms/${STATE.roomId}/homeworkState`).off();
    db.ref(`rooms/${STATE.roomId}/homeworkState`).on('value', snap => {
        const hw = snap.val();
        if (!hw || !hw.active) {
            // Homework ended — show results
            showHomeworkResults();
            return;
        }

        const presenting = hw.presentingTeam;
        const phase = hw.phase || 'waiting';
        const label = document.getElementById('hw-presenting-label');

        // Hide all content panels
        document.getElementById('hw-presenting-own').style.display = 'none';
        document.getElementById('hw-leader-eval').style.display = 'none';
        document.getElementById('hw-member-waiting').style.display = 'none';
        document.getElementById('hw-results-panel').style.display = 'none';

        if (!presenting) {
            label.textContent = 'Đang chờ giáo viên chọn tổ trình bày...';
            document.getElementById('hw-member-waiting').style.display = '';
            document.getElementById('hw-member-waiting').innerHTML = `
                <div class="hw-member-info-icon">⏳</div>
                <p class="hw-member-info-text">Đang chờ giáo viên chọn tổ trình bày tiếp theo...</p>`;
            document.getElementById('hw-results-panel').style.display = '';
            return;
        }

        // Resolve teamTasks then find presenting team info
        resolveTeamTasks(hw, (teamTasks) => {
            db.ref(`rooms/${STATE.roomId}/teamConfig/teams`).once('value', tcSnap => {
                const teams = tcSnap.val() || {};
                const teamKeys = Object.keys(teams);
                const presentingIdx = teamKeys.indexOf(presenting);
                const pt = teams[presenting];
                const ptName = pt ? pt.name : presenting;
                const ptColor = pt ? pt.color : '#888';
                const ptTask = presentingIdx >= 0 ? (teamTasks[presentingIdx] || '') : '';

            if (phase === 'presenting') {
                // ====== PHASE: TRÌNH BÀY ======
                label.innerHTML = `<span style="color:${ptColor}"><i class="fas fa-microphone"></i> ${ptName} đang trình bày</span>`;

                if (presenting === STATE.teamId) {
                    // Tổ mình đang trình bày
                    document.getElementById('hw-presenting-own').style.display = '';
                    document.getElementById('hw-presenting-own').innerHTML = `
                        <div class="hw-presenting-icon">🎤</div>
                        <h3>Tổ bạn đang trình bày!</h3>
                        ${ptTask ? `<div class="hw-presenting-task"><i class="fas fa-clipboard-list"></i> <strong>Nhiệm vụ:</strong> ${ptTask}</div>` : ''}
                        <p>Hãy lên bảng trình bày sản phẩm nhiệm vụ về nhà của tổ bạn.</p>`;
                } else {
                    // Tổ khác → xem trình bày (chưa được đánh giá)
                    document.getElementById('hw-member-waiting').style.display = '';
                    document.getElementById('hw-member-waiting').innerHTML = `
                        <div class="hw-member-info-icon">📋</div>
                        <h4 style="color:${ptColor};margin:0 0 8px">${ptName} đang trình bày</h4>
                        ${ptTask ? `<div class="hw-presenting-task"><i class="fas fa-clipboard-list"></i> <strong>Nhiệm vụ:</strong> ${ptTask}</div>` : ''}
                        <p class="hw-member-info-text">Hãy lắng nghe và quan sát. Sau khi trình bày xong, giáo viên sẽ mở phần đánh giá.</p>`;
                }
                document.getElementById('hw-results-panel').style.display = '';

            } else if (phase === 'evaluating') {
                // ====== PHASE: ĐÁNH GIÁ ======
                label.innerHTML = `<span style="color:#ffd700"><i class="fas fa-star"></i> Đánh giá ${ptName}</span>`;

                if (presenting === STATE.teamId) {
                    // Tổ mình bị đánh giá → chờ kết quả
                    document.getElementById('hw-member-waiting').style.display = '';
                    document.getElementById('hw-member-waiting').innerHTML = `
                        <div class="hw-member-info-icon">⏳</div>
                        <h4 style="color:${ptColor};margin:0 0 8px">${ptName} đang được đánh giá</h4>
                        <p class="hw-member-info-text">Các tổ khác và giáo viên đang đánh giá sản phẩm của tổ bạn.</p>`;
                } else if (STATE.teamRole === 'leader') {
                    // Tổ trưởng tổ khác → form đánh giá
                    const evalForm = document.getElementById('hw-leader-eval');
                    evalForm.style.display = '';
                    const targetName = document.getElementById('hw-eval-target-name');
                    targetName.textContent = ptName;
                    targetName.dataset.teamId = presenting;
                    // Hiện nhiệm vụ được giao
                    document.getElementById('hw-eval-task-desc').textContent = ptTask ? `Nhiệm vụ: ${ptTask}` : '';
                    // Check nếu đã đánh giá tổ này rồi
                    db.ref(`rooms/${STATE.roomId}/homeworkEvals/${presenting}/${STATE.teamId}`).once('value', evSnap => {
                        if (evSnap.val()) {
                            document.getElementById('hw-eval-submitted').style.display = '';
                            document.getElementById('btn-hw-submit-eval').disabled = true;
                        } else {
                            document.getElementById('hw-eval-submitted').style.display = 'none';
                            document.getElementById('btn-hw-submit-eval').disabled = false;
                            document.getElementById('hw-eval-score').value = 7;
                            document.getElementById('hw-score-display').textContent = '7';
                            document.getElementById('hw-eval-comment').value = '';
                        }
                    });
                } else {
                    // Thành viên → xem, không đánh giá
                    document.getElementById('hw-member-waiting').style.display = '';
                    document.getElementById('hw-member-waiting').innerHTML = `
                        <div class="hw-member-info-icon">👀</div>
                        <h4 style="color:#ffd700;margin:0 0 8px">Đang đánh giá ${ptName}</h4>
                        <p class="hw-member-info-text">Tổ trưởng đang đánh giá. Bạn có thể theo dõi kết quả bên dưới.</p>`;
                }
                // Luôn hiện bảng kết quả
                document.getElementById('hw-results-panel').style.display = '';
            }
            });
        });
    });

    // Listen for results display
    db.ref(`rooms/${STATE.roomId}/homeworkEvals`).off();
    db.ref(`rooms/${STATE.roomId}/homeworkEvals`).on('value', snap => {
        const evals = snap.val() || {};
        db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value', tcSnap => {
            const tc = tcSnap.val();
            if (tc) renderScoreMatrix(tc, evals, 'hw-student-matrix');
        });
        // Show results panel if there are any evals
        if (Object.keys(evals).length > 0) {
            document.getElementById('hw-results-panel').style.display = '';
        }
    });
}

function showHomeworkResults() {
    // Clean up listeners
    db.ref(`rooms/${STATE.roomId}/homeworkState`).off();
    db.ref(`rooms/${STATE.roomId}/homeworkEvals`).off();



    // Load and render the final evaluation results into the homework tab
    db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value', tcSnap => {
        const tc = tcSnap.val();
        if (!tc) return;
        db.ref(`rooms/${STATE.roomId}/homeworkEvals`).once('value', evSnap => {
            const evals = evSnap.val() || {};
            renderScoreMatrix(tc, evals, 'sh-hw-matrix');
        });
    });

    // Set homework title
    db.ref(`rooms/${STATE.roomId}/homeworkState/title`).once('value', snap => {
        const title = snap.val();
        const titleEl = document.getElementById('sh-hw-title');
        if (titleEl && title) titleEl.textContent = title;
    });

    // Navigate back to student-home
    showScreen('student-home');
    initStudentHome();
    showToast('Hoạt động nhiệm vụ về nhà đã kết thúc! 🏠', 'info');

    // Auto-switch to homework tab
    setTimeout(() => {
        const hwTab = document.querySelector('[data-tab="sh-tab-homework"]');
        if (hwTab) hwTab.click();
    }, 300);
}

// Load homework evaluation results into the student tab
function loadHomeworkResultsTab() {
    const container = document.getElementById('sh-hw-matrix');
    if (!container) return;

    db.ref(`rooms/${STATE.roomId}/teamConfig`).once('value', tcSnap => {
        const tc = tcSnap.val();
        if (!tc || !tc.teams) {
            container.innerHTML = '<p class="empty-state"><i class="fas fa-clipboard-list"></i> Chưa có kết quả đánh giá nào.</p>';
            return;
        }
        db.ref(`rooms/${STATE.roomId}/homeworkEvals`).once('value', evSnap => {
            const evals = evSnap.val() || {};
            if (Object.keys(evals).length === 0) {
                container.innerHTML = '<p class="empty-state"><i class="fas fa-clipboard-list"></i> Chưa có kết quả đánh giá nào.</p>';
                return;
            }
            renderScoreMatrix(tc, evals, 'sh-hw-matrix');
        });
    });

    // Update title
    db.ref(`rooms/${STATE.roomId}/homeworkState/title`).once('value', snap => {
        const title = snap.val();
        const el = document.getElementById('sh-hw-title');
        if (el) el.textContent = title || '';
    });
}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
    getAuth, signInWithRedirect, getRedirectResult,
    GoogleAuthProvider, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
    getFirestore, doc, setDoc, getDoc, updateDoc,
    collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// ========== Firebase 初始化 ==========
const firebaseConfig = {
    apiKey: "AIzaSyBrKv83q_URyL2QpWogPqh-4ebZ-GNJ5Js",
    authDomain: "edu-spark2026.firebaseapp.com",
    projectId: "edu-spark2026",
    storageBucket: "edu-spark2026.firebasestorage.app",
    messagingSenderId: "803298416028",
    appId: "1:803298416028:web:18879dec8e1e8db1596459"
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ========== 全域狀態 ==========
let currentUser = null;
let userData    = null;
let redemptionHistory = [];
window.leaderboardUsers = [];
window.isGuestMode = false;

// ========== 頭像與相簿工具 ==========
window.generateAvatarSvg = (letter = '火', bgColor = '#C66E52') => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
        <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
            <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${bgColor}" />
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0.2" />
            </linearGradient></defs>
            <rect width="120" height="120" rx="60" fill="url(#g)" />
            <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="58" font-family="Noto Serif TC, serif" fill="white" font-weight="700">${letter}</text>
        </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

window.avatarPatterns = [
    window.generateAvatarSvg('火', '#F18D40'),
    window.generateAvatarSvg('學', '#5A9B7F'),
    window.generateAvatarSvg('院', '#4A7DAA'),
    window.generateAvatarSvg('星', '#D9646E'),
    window.generateAvatarSvg('光', '#8D63A6')
];

window.setAvatar = (avatarUrl) => {
    if (!userData) return;
    userData.avatar = avatarUrl;
    const preview = document.getElementById('edit-avatar-preview');
    if (preview) preview.src = avatarUrl;
    const homeAvatar = document.getElementById('home-avatar');
    if (homeAvatar) homeAvatar.src = avatarUrl;
};

window.resetAvatar = () => {
    const defaultAvatar = currentUser?.photoURL || window.generateAvatarSvg((userData?.nickname || '你')[0], '#C66E52');
    window.setAvatar(defaultAvatar);
};

window.renderAvatarAlbum = () => {
    const container = document.getElementById('avatar-album');
    if (!container) return;
    container.innerHTML = window.avatarPatterns.map((url, index) => `
        <img src="${url}" class="album-thumb" data-url="${url}" onclick="window.selectAvatarPattern(this.dataset.url)" style="width:56px; height:56px; border-radius:16px; object-fit:cover; cursor:pointer; border: 2px solid transparent;">
    `).join('');
};

window.selectAvatarPattern = (patternUrl) => {
    window.setAvatar(patternUrl);
    const items = document.querySelectorAll('#avatar-album img');
    items.forEach(img => img.style.borderColor = img.src === patternUrl ? '#F08A1E' : 'transparent');
};

// ========== 排行榜與詳細資訊 ==========
window.showSocialDetail = (uid) => {
    const user = window.leaderboardUsers.find(item => item.id === uid);
    const detail = document.getElementById('leaderboard-detail');
    const overlay = document.getElementById('leaderboard-detail-overlay');
    const content = document.getElementById('detail-content');
    if (!user || !detail) return;
    content.innerHTML = `
        <div class="detail-row">
            <img src="${user.avatar || window.generateAvatarSvg(user.nickname?.[0] || '友', '#758A93')}" alt="${user.nickname} 頭像">
            <div>
                <div class="detail-name">${user.nickname}${user.id === currentUser?.uid ? ' <span class="me-badge">（我）</span>' : ''}</div>
                <div class="detail-text">${user.dept || '系級未填'}</div>
            </div>
        </div>
        <div class="detail-text">${user.bio || '尚未留下自我介紹'}</div>
    `;
    detail.classList.add('active');
    overlay.classList.add('active');
};

window.closeSocialDetail = () => {
    const detail = document.getElementById('leaderboard-detail');
    const overlay = document.getElementById('leaderboard-detail-overlay');
    if (detail) detail.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
};

const activateView = (viewId) => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(viewId);
    if (view) view.classList.add('active');
    const container = document.querySelector('.view-container');
    if (container) container.scrollTop = 0;
    if (window.closeSocialDetail) window.closeSocialDetail();
};

// --- 處理行動裝置 Redirect 結果 ---
// 這一行非常重要，它會捕捉從 Google 頁面跳轉回來的登入資訊
getRedirectResult(auth).then((result) => {
    if (result?.user) {
        console.log('Redirect login successful:', result.user.email);
        // onAuthStateChanged 會處理後續
    }
}).catch((error) => {
    console.error("重新導向登入出錯:", error);
    if (window.showToast) window.showToast("登入連線中斷，請再試一次");
});

// --- 修正後的登入監聽邏輯 ---
onAuthStateChanged(auth, async (user) => {
    const loading = document.getElementById('loading-overlay');
    try {
        if (user) {
            currentUser = user;
            const snap = await getDoc(doc(db, "users", user.uid));
            
            if (snap.exists()) {
                userData = snap.data();
                if (!userData.history) userData.history = [];
                if (!userData.avatar) {
                    userData.avatar = user.photoURL || window.generateAvatarSvg((userData.nickname || '你')[0], '#C66E52');
                }
                redemptionHistory = userData.history;
                activateView('view-home');
                document.getElementById('main-nav').style.display = 'flex';
                if (window.updatePointsUI) window.updatePointsUI();
                if (window.applyUserAvatar) window.applyUserAvatar();
            } else {
                // 如果是新用戶，進入設定畫面
                activateView('view-setup');
                document.getElementById('main-nav').style.display = 'flex';
            }
        } else {
            // 確實沒有登入狀態，才顯示登入頁面
            activateView('view-login');
            document.getElementById('main-nav').style.display = 'none';
        }
    } catch (err) {
        console.error("初始化錯誤:", err);
        if (window.showToast) window.showToast("資料讀取失敗，請重新整理");
        activateView('view-login');
    } finally {
        // 無論結果如何，500ms 後關閉載入畫面，避免卡死
        if (loading) setTimeout(() => { loading.style.display = 'none'; }, 500);
    }
});

// ========== 帳號相關 ==========

window.loginWithGoogle = () => {
    document.getElementById('loading-overlay').style.display = 'flex';
    signInWithRedirect(auth, provider);
};

window.logout = () => {
    if (!window.isGuestMode) {
        signOut(auth);
    }
    redemptionHistory = [];
    currentUser = null;
    userData = null;
    window.isGuestMode = false;
    localStorage.removeItem('guest_user_data');
    localStorage.removeItem('guest_redemption_history');
    activateView('view-login');
    const nav = document.getElementById('main-nav');
    if (nav) nav.style.display = 'none';
    if (window.showToast) window.showToast('已登出，歡迎下次再來！');
};

window.loginAsGuest = async () => {
    window.isGuestMode = true;
    currentUser = null;
    const guestData = localStorage.getItem('guest_user_data');
    if (guestData) {
        userData = JSON.parse(guestData);
        redemptionHistory = JSON.parse(localStorage.getItem('guest_redemption_history') || '[]');
    } else {
        userData = {
            realName: '訪客',
            nickname: '小火花遊客',
            dept: '訪客模式',
            bio: '這是訪客測試帳號，數據不會被保存。',
            points: 0,
            history: [],
            avatar: window.generateAvatarSvg('訪', '#8D63A6')
        };
        redemptionHistory = [];
    }
    activateView('view-home');
    const nav = document.getElementById('main-nav');
    if (nav) nav.style.display = 'flex';
    if (window.updatePointsUI) window.updatePointsUI();
    if (window.applyUserAvatar) window.applyUserAvatar();
    if (window.showToast) window.showToast('歡迎以訪客模式遊玩！數據不會被保存。');
};

// ========== 建立帳號 ==========
window.completeSetup = async () => {
    const realName = document.getElementById('setup-realname').value.trim();
    const nickname = document.getElementById('setup-nickname').value.trim();
    const dept     = document.getElementById('setup-dept').value.trim();
    const bio      = document.getElementById('setup-bio').value.trim();
    if (!realName || !nickname) return window.showToast('請填寫姓名與暱稱');
    const avatar = currentUser?.photoURL || window.generateAvatarSvg(nickname[0], '#C66E52');
    userData = { realName, nickname, dept, bio, points: 0, history: [], avatar };
    if (window.isGuestMode) {
        localStorage.setItem('guest_user_data', JSON.stringify(userData));
    } else {
        await setDoc(doc(db, "users", currentUser.uid), userData);
    }
    redemptionHistory = [];
    window.switchView('view-home');
    document.getElementById('main-nav').style.display = 'flex';
    window.updatePointsUI();
    window.applyUserAvatar();
};

// ========== 更新個人資料 ==========
window.updateProfile = async () => {
    const realName = document.getElementById('edit-realname').value.trim();
    const nickname = document.getElementById('edit-nickname').value.trim();
    const dept     = document.getElementById('edit-dept').value.trim();
    const bio      = document.getElementById('edit-bio').value.trim();
    if (window.isGuestMode) {
        userData = { ...userData, realName, nickname, dept, bio };
        localStorage.setItem('guest_user_data', JSON.stringify(userData));
    } else {
        await updateDoc(doc(db, "users", currentUser.uid), {
            realName,
            nickname,
            dept,
            bio,
            avatar: userData.avatar
        });
        userData = { ...userData, realName, nickname, dept, bio };
    }
    window.showToast('修改成功！');
    window.switchView('view-home');
    window.applyUserAvatar();
};

// ========== 獲得積分 ==========
window.earnPoints = async (btnElement, pointsToAdd, taskName) => {
    if (btnElement.classList.contains('completed')) return;

    userData.points += pointsToAdd;
    if (window.isGuestMode) {
        localStorage.setItem('guest_user_data', JSON.stringify(userData));
    } else {
        await updateDoc(doc(db, "users", currentUser.uid), { points: userData.points });
    }

    if (!btnElement.dataset.originalText) {
        btnElement.dataset.originalText = btnElement.innerHTML;
    }
    btnElement.classList.add('completed');
    btnElement.innerHTML = btnElement.dataset.originalText +
        '<span class="completed-text">（已完成）</span>';

    window.updatePointsUI();
    window.showToast(`完成「${taskName}」獲得積分 ${pointsToAdd} 點！`);
};

// ========== 重置關卡 ==========
window.resetTasks = () => {
    const completed = document.querySelectorAll('.task-btn.completed');
    if (completed.length === 0) {
        window.showToast('目前沒有需要重置的關卡喔！');
        return;
    }
    completed.forEach(btn => {
        btn.classList.remove('completed');
        if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
    });
    window.showToast('關卡已重置！你可以繼續累積積分囉！');
};

// ========== 重置積分 ==========
window.hardResetScore = async () => {
    if (!userData || userData.points === 0) {
        window.showToast('積分已經是 0 囉！');
        return;
    }
    if (!confirm('確認是否重置積分？\n你的積分一旦重置將無法復原，不如拿去兌換獎勵吧！')) {
        return;
    }
    userData.points = 0;
    if (window.isGuestMode) {
        localStorage.setItem('guest_user_data', JSON.stringify(userData));
    } else {
        await updateDoc(doc(db, "users", currentUser.uid), { points: 0 });
    }
    window.updatePointsUI();
    window.showToast('積分已歸零重置！');
};

// ========== 兌換獎勵 ==========
window.redeemReward = async (cost, rewardName) => {
    if (userData.points >= cost) {
        userData.points -= cost;
        const now = new Date();
        const timeString = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        redemptionHistory.unshift({ name: rewardName, time: timeString });
        userData.history = redemptionHistory;

        if (window.isGuestMode) {
            localStorage.setItem('guest_user_data', JSON.stringify(userData));
            localStorage.setItem('guest_redemption_history', JSON.stringify(redemptionHistory));
        } else {
            await updateDoc(doc(db, "users", currentUser.uid), {
                points: userData.points,
                history: redemptionHistory
            });
        }

        window.updatePointsUI();
        window.renderHistory();
        window.showToast(`成功兌換「${rewardName}」！已扣除 ${cost} 點`);
    } else {
        const shortage = cost - userData.points;
        window.showToast(`積分不足喔！還差 ${shortage} 點才能兌換`);
    }
};

// ========== 歷史紀錄 ==========
window.renderHistory = () => {
    const container = document.getElementById('history-container');
    if (redemptionHistory.length === 0) {
        container.innerHTML = "<p class='empty-history'>尚無兌換紀錄，快去闖關累積點數吧！</p>";
        return;
    }
    container.innerHTML = redemptionHistory.map(item => `
        <div class="history-item">
            <span class="history-name">${item.name}</span>
            <span class="history-time">${item.time}</span>
        </div>
    `).join('');
};

window.clearHistory = async () => {
    if (redemptionHistory.length === 0) {
        window.showToast('目前沒有紀錄可以清空喔！');
        return;
    }
    redemptionHistory = [];
    userData.history = [];
    if (window.isGuestMode) {
        localStorage.setItem('guest_user_data', JSON.stringify(userData));
        localStorage.setItem('guest_redemption_history', JSON.stringify(redemptionHistory));
    } else {
        await updateDoc(doc(db, "users", currentUser.uid), { history: [] });
    }
    window.renderHistory();
    window.showToast('歷史紀錄已清空！');
};

// ========== 排行榜 ==========
window.fetchLeaderboard = async () => {
    const list = document.getElementById('leaderboard-list');
    if (window.isGuestMode) {
        list.innerHTML = '<p class="empty-history" style="margin-top: 30px;">訪客模式下無法查看排行榜，請登入帳號查看完整社群排行。</p>';
        return;
    }
    const q    = query(collection(db, "users"), orderBy("points", "desc"));
    const snap = await getDocs(q);
    list.innerHTML = '';
    window.leaderboardUsers = [];
    let rank = 1;
    snap.forEach(d => {
        const data = d.data();
        const isMe = d.id === currentUser?.uid;
        const avatarUrl = data.avatar || window.generateAvatarSvg(data.nickname?.[0] || '友', '#758A93');
        window.leaderboardUsers.push({ id: d.id, ...data, avatar: avatarUrl });
        list.innerHTML += `
            <div class="leaderboard-item ${isMe ? 'leaderboard-item-me' : ''}" onclick="window.showSocialDetail('${d.id}')">
                <div class="rank-badge">${rank++}</div>
                <div class="leader-avatar-wrapper"><img src="${avatarUrl}" class="leader-avatar" alt="${data.nickname} 頭像"></div>
                <div class="user-details">
                    <div class="user-name-tag">${data.nickname}${isMe ? ' <span class="me-badge">（我）</span>' : ''}</div>
                    <div class="user-dept-tag">${data.dept || '教院小夥伴'}</div>
                </div>
                <div class="user-points-tag">${data.points}點</div>
            </div>`;
    });
};

// ========== 視圖切換 ==========
window.switchView = (viewId) => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    document.querySelector('.view-container').scrollTop = 0;
    window.closeSocialDetail();

    if (viewId === 'view-social')  window.fetchLeaderboard();
    if (viewId === 'view-history') window.renderHistory();
    if (viewId === 'view-profile' && userData) {
        document.getElementById('edit-realname').value = userData.realName  || '';
        document.getElementById('edit-nickname').value = userData.nickname  || '';
        document.getElementById('edit-dept').value     = userData.dept      || '';
        document.getElementById('edit-bio').value      = userData.bio       || '';
        document.getElementById('edit-avatar-preview').src = userData.avatar || window.generateAvatarSvg(userData.nickname?.[0] || '你', '#C66E52');
        window.renderAvatarAlbum();
        window.selectAvatarPattern(document.getElementById('edit-avatar-preview').src);
    }
};

window.navTo = (viewId, el) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    window.switchView(viewId);
};

// ========== UI 更新 ==========
window.updatePointsUI = () => {
    const pts = userData ? userData.points : 0;
    document.querySelectorAll('.global-points').forEach(el => el.innerText = pts);
    window.applyUserAvatar();
};

window.applyUserAvatar = () => {
    const avatarUrl = userData?.avatar || currentUser?.photoURL || window.generateAvatarSvg(userData?.nickname?.[0] || '你', '#C66E52');
    const homeAvatar = document.getElementById('home-avatar');
    const profilePreview = document.getElementById('edit-avatar-preview');
    if (homeAvatar) homeAvatar.src = avatarUrl;
    if (profilePreview) profilePreview.src = avatarUrl;
};

window.showComingSoon = () => window.showToast('敬請期待！');

// ========== Toast 通知 ==========
let toastTimeout;
window.showToast = (msg) => {
    const t = document.getElementById('toast');
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 2500);
};

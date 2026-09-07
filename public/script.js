import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
    connectAuthEmulator, getAuth, signInWithPopup,
    GoogleAuthProvider, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
    getFirestore, collection, query, getDocs, orderBy, limit, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
    getFunctions, httpsCallable, connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
import {
    initializeAppCheck, ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";

// ========== Firebase 初始化 ==========
const useLocalEmulators = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const productionFirebaseConfig = {
    apiKey: "AIzaSyD4tdUd6o06zxMyyOq8CwyZuixrIh5j0Kk",
    authDomain: "coespark-a3f6e.firebaseapp.com",
    projectId: "coespark-a3f6e",
    storageBucket: "coespark-a3f6e.firebasestorage.app",
    messagingSenderId: "495581170629",
    appId: "1:495581170629:web:aba68ff657942cf77b99ac",
    measurementId: "G-7WB0WT0QP1"
};
const firebaseConfig = useLocalEmulators
    ? {
        ...productionFirebaseConfig,
        authDomain: 'demo-eduspark.firebaseapp.com',
        projectId: 'demo-eduspark',
        storageBucket: 'demo-eduspark.appspot.com'
    }
    : productionFirebaseConfig;

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const functions = getFunctions(app, "asia-east1");
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

if (useLocalEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

const appCheckSiteKey = document.querySelector('meta[name="firebase-app-check-site-key"]')?.content.trim();
if (appCheckSiteKey) {
    initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true
    });
}

const callGetMyProfile = httpsCallable(functions, 'getMyProfile');
const callSaveProfile = httpsCallable(functions, 'saveProfile');
const callRedeemReward = httpsCallable(functions, 'redeemReward');
const callRedeemQr = httpsCallable(functions, 'redeemQr');
const callCreateQrCampaign = httpsCallable(functions, 'createQrCampaign');
const callListQrCampaigns = httpsCallable(functions, 'listQrCampaigns');
const callGetQrCampaign = httpsCallable(functions, 'getQrCampaign');
const callSetQrCampaignStatus = httpsCallable(functions, 'setQrCampaignStatus');
const callLookupAdminUser = httpsCallable(functions, 'lookupAdminUser');
const callListAdminUsers = httpsCallable(functions, 'listAdminUsers');
const callSetAdminRole = httpsCallable(functions, 'setAdminRole');
const callBootstrapSuperAdmin = httpsCallable(functions, 'bootstrapSuperAdmin');
const callCreateWish = httpsCallable(functions, 'createWish');
const callListWishes = httpsCallable(functions, 'listWishes');
const callToggleWishLike = httpsCallable(functions, 'toggleWishLike');
const callListPublishedAnnouncements = httpsCallable(functions, 'listPublishedAnnouncements');
const callListPublicQrCampaigns = httpsCallable(functions, 'listPublicQrCampaigns');
const callGetPointHistory = httpsCallable(functions, 'getPointHistory');

// ========== 全域狀態 ==========
let currentUser = null;
let userData    = null;
let authenticatedUserLoadPromise = null;
let authenticatedUserLoadUid = null;
let redemptionHistory = [];
window.leaderboardUsers = [];
window.isGuestMode = false;
window.isAdmin = false;
window.isSuperAdmin = false;
window.leaderboardMode = 'current';

const sparkLevels = [
    {level: 1, minimum: 0, name: '初生火苗', image: 'assets/levels/lv1.png'},
    {level: 2, minimum: 10, name: '探索火花', image: 'assets/levels/lv2.png'},
    {level: 3, minimum: 20, name: '熱情火焰', image: 'assets/levels/lv3.png'},
    {level: 4, minimum: 30, name: '幻藍大火焰', image: 'assets/levels/lv4.png'}
];

window.getSparkLevel = (totalPoints = 0) => {
    const total = Math.max(0, Math.floor(Number(totalPoints) || 0));
    const index = Math.min(Math.floor(total / 10), sparkLevels.length - 1);
    const level = sparkLevels[index];
    const progress = index === sparkLevels.length - 1 ? 10 : total - level.minimum;
    return {...level, totalPoints: total, progress};
};

window.renderSparkLevel = (totalPoints = 0) => {
    const level = window.getSparkLevel(totalPoints);
    const image = document.getElementById('spark-level-image');
    const name = document.getElementById('spark-level-name');
    const progress = document.getElementById('spark-level-progress');
    const label = document.getElementById('spark-level-progress-label');
    if (image) {
        image.src = level.image;
        image.alt = level.name;
    }
    if (name) name.textContent = level.name;
    if (progress) {
        progress.setAttribute('aria-valuenow', String(level.progress));
        progress.setAttribute('aria-valuetext', level.level === 4 ? '已達最高等級' : `${level.progress}/10`);
        progress.style.setProperty('--spark-progress', `${level.progress * 10}%`);
    }
    if (label) {
        label.textContent = level.level === 4
            ? 'LV. 4（已達最高等級）'
            : `LV. ${level.level}（${level.progress}/10）`;
    }
};

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const safeImageUrl = (value) => {
    const url = String(value ?? '');
    return url.startsWith('https://') || url.startsWith('data:image/svg+xml') ? url : '';
};

const escapeSvgText = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

// ========== 頭像與相簿工具 ==========
window.generateAvatarSvg = (letter = '火', bgColor = '#C66E52') => {
    const safeLetter = escapeSvgText([...String(letter)][0] || '火');
    const safeColor = /^#[0-9a-f]{6}$/i.test(String(bgColor)) ? bgColor : '#C66E52';
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
        <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
            <rect width="120" height="120" rx="60" fill="${safeColor}" />
            <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-size="58" font-family="Huninn, sans-serif" fill="white" font-weight="700">${safeLetter}</text>
        </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

window.avatarPalette = ['#9d3737', '#C66E52', '#ceb55a', '#49726e', '#39596d', '#725b85', '#cc98a0'];
window.defaultAvatarBackgroundColor = '#C66E52';
window.currentAvatarSelection = { letter: '火', color: window.defaultAvatarBackgroundColor };

window.setAvatar = (avatarUrl) => {
    if (!userData) return;
    userData.avatar = avatarUrl;
    const preview = document.getElementById('edit-avatar-preview');
    if (preview) preview.src = avatarUrl;
    const homeAvatar = document.getElementById('home-avatar');
    if (homeAvatar) homeAvatar.src = avatarUrl;
};

window.parseRedeemCost = (historyItem) => {
    if (typeof historyItem.cost === 'number') return historyItem.cost;
    if (typeof historyItem.cost === 'string' && historyItem.cost.trim() !== '') {
        return Number(historyItem.cost) || 0;
    }
    return 0;
};

window.getRedeemedPoints = (history = []) => {
    return history.reduce((total, item) => total + (window.parseRedeemCost(item) || 0), 0);
};

window.updateHistorySummary = () => {
    const summary = document.getElementById('history-summary');
    if (!summary) return;
    const total = window.getRedeemedPoints(redemptionHistory);
    summary.innerText = total > 0 ? `目前累積兌換點數：-${total}點` : '目前累積兌換點數：0點';
};

window.switchLeaderboardMode = (mode) => {
    if (!['current', 'total'].includes(mode)) return;
    window.leaderboardMode = mode;
    document.querySelectorAll('.leaderboard-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    window.fetchLeaderboard();
};

window.getDefaultAvatarSelection = (nickname = '') => {
    const chars = window.getNicknameAvatarChars(nickname);
    return {
        letter: chars[0] || '火',
        color: window.defaultAvatarBackgroundColor
    };
};

window.initAvatarSelectionFromNickname = (nickname = '') => {
    window.currentAvatarSelection = window.getDefaultAvatarSelection(nickname);
};

window.toggleAvatarSettings = () => {
    const panel = document.getElementById('avatar-custom-panel');
    if (!panel) return;
    const isActive = panel.classList.toggle('active');
    if (isActive) {
        panel.classList.remove('hidden');
        window.renderAvatarOptions();
    }
};

window.closeAvatarSettings = () => {
    const panel = document.getElementById('avatar-custom-panel');
    if (!panel) return;
    panel.classList.remove('active');
};

window.resetAvatar = () => {
    const defaultLetter = (userData?.nickname || '你').trim().charAt(0) || '火';
    const defaultAvatar = currentUser?.photoURL || window.getAvatarPreviewUrl(defaultLetter, window.defaultAvatarBackgroundColor);
    window.currentAvatarSelection = { letter: defaultLetter, color: window.defaultAvatarBackgroundColor };
    window.setAvatar(defaultAvatar);
};

window.getNicknameAvatarChars = (nickname = '') => {
    const chars = [...new Set([...String(nickname).trim()].filter(ch => ch !== ''))];
    return chars.length > 0 ? chars : ['火'];
};

window.getAvatarPreviewUrl = (letter, bgColor) => window.generateAvatarSvg(letter, bgColor);

window.updateAvatarOptionHighlights = () => {
    document.querySelectorAll('.avatar-char-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.letter === window.currentAvatarSelection.letter);
    });
    document.querySelectorAll('.avatar-color-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === window.currentAvatarSelection.color);
    });
    document.querySelectorAll('.avatar-thumb').forEach(img => {
        img.classList.toggle('active', img.dataset.letter === window.currentAvatarSelection.letter && img.dataset.color === window.currentAvatarSelection.color);
    });
};

window.renderAvatarOptions = () => {
    const nickname = document.getElementById('edit-nickname')?.value.trim() || userData?.nickname || '';
    const chars = window.getNicknameAvatarChars(nickname);
    if (!chars.includes(window.currentAvatarSelection.letter)) {
        window.currentAvatarSelection.letter = chars[0];
    }
    if (!window.avatarPalette.includes(window.currentAvatarSelection.color)) {
        window.currentAvatarSelection.color = window.avatarPalette[0];
    }

    const charContainer = document.getElementById('avatar-char-options');
    if (charContainer) {
        charContainer.innerHTML = chars.map(ch => `
            <button type="button" class="avatar-char-btn" data-letter="${escapeHtml(ch)}">${escapeHtml(ch)}</button>
        `).join('');
        charContainer.querySelectorAll('.avatar-char-btn').forEach(button => {
            button.addEventListener('click', () => window.updateAvatarSelection(button.dataset.letter, null));
        });
    }

    const paletteContainer = document.getElementById('avatar-color-palette');
    if (paletteContainer) {
        paletteContainer.innerHTML = window.avatarPalette.map(color => `
            <button type="button" class="avatar-color-swatch" data-color="${color}" style="background:${color};" onclick="window.updateAvatarSelection(null, '${color}')"></button>
        `).join('');
    }

    const albumContainer = document.getElementById('avatar-album');
    if (albumContainer) {
        albumContainer.innerHTML = '';
    }

    window.updateAvatarOptionHighlights();
};

window.updateAvatarSelection = (letter, color) => {
    if (letter) window.currentAvatarSelection.letter = letter;
    if (color) window.currentAvatarSelection.color = color;
    const preview = document.getElementById('edit-avatar-preview');
    if (preview) preview.src = window.getAvatarPreviewUrl(window.currentAvatarSelection.letter, window.currentAvatarSelection.color);
    window.updateAvatarOptionHighlights();
};

window.updateBioCount = () => {
    const bio = document.getElementById('edit-bio');
    const counter = document.getElementById('bio-count');
    if (!bio || !counter) return;
    counter.innerText = `${bio.value.length}/50`;
};

window.selectAvatarPattern = (letter, color) => {
    const avatarUrl = window.getAvatarPreviewUrl(letter, color);
    window.currentAvatarSelection.letter = letter;
    window.currentAvatarSelection.color = color;
    window.setAvatar(avatarUrl);
    window.updateAvatarOptionHighlights();
};

// ========== 排行榜與詳細資訊 ==========
window.getSocialUserDisplayData = (user = {}) => {
    const nickname = user.nickname || user.displayName || user.name || '小火花夥伴';
    const dept = user.dept || user.department || user.className || user.class || '系級未填';
    const bio = String(user.bio || user.introduction || user.selfIntro || user.intro || user.description || user.about || '尚未留下自我介紹').slice(0, 50);
    const avatar = user.avatar || user.photoURL || user.avatarUrl || window.generateAvatarSvg((nickname || '友').trim().charAt(0) || '友', '#758A93');
    const points = Number(user.points || 0);
    const redeemed = Number(user.redeemed || 0);
    const totalPoints = Number(user.totalPoints ?? points + redeemed);

    return {
        nickname,
        dept,
        bio,
        avatar,
        points,
        redeemed,
        totalPoints
    };
};

window.showSocialDetail = (uid) => {
    const user = window.leaderboardUsers.find(item => item.id === uid);
    const detail = document.getElementById('leaderboard-detail');
    const overlay = document.getElementById('leaderboard-detail-overlay');
    const content = document.getElementById('detail-content');
    if (!user || !detail) return;

    const profile = window.getSocialUserDisplayData(user);
    const avatar = safeImageUrl(profile.avatar) || window.generateAvatarSvg(profile.nickname, '#758A93');
    content.innerHTML = `
        <div class="detail-row">
            <img src="${escapeHtml(avatar)}" alt="${escapeHtml(profile.nickname)} 頭像">
            <div>
                <div class="detail-name">${escapeHtml(profile.nickname)}${user.id === currentUser?.uid ? ' <span class="me-badge">（我）</span>' : ''}</div>
                <div class="detail-text">${escapeHtml(profile.dept)}</div>
            </div>
        </div>
        <div class="detail-info-block">
            <div class="detail-text"><strong>自我介紹：</strong>${escapeHtml(profile.bio)}</div>
        </div>
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

const setActiveNavItem = (viewId) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const target = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (target) target.classList.add('active');
};

const activateView = (viewId) => {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(viewId);
    if (view) view.classList.add('active');
    const container = document.querySelector('.view-container');
    if (container) container.scrollTop = 0;
    if (window.closeSocialDetail) window.closeSocialDetail();
    if (['view-reward', 'view-home', 'view-social'].includes(viewId)) {
        setActiveNavItem(viewId);
    }
};

const setMainNavVisible = (visible) => {
    const nav = document.getElementById('main-nav');
    if (nav) nav.style.display = visible ? 'flex' : 'none';
};

const setAdminState = (isAdmin, isSuperAdmin = false, canBootstrap = false) => {
    window.isSuperAdmin = isSuperAdmin === true;
    window.isAdmin = isAdmin === true || window.isSuperAdmin;
    const adminButton = document.getElementById('admin-entry-btn');
    if (adminButton) adminButton.style.display = window.isAdmin ? 'block' : 'none';
    const roleButton = document.getElementById('admin-role-entry-btn');
    if (roleButton) roleButton.style.display = window.isSuperAdmin ? 'block' : 'none';
    const bootstrapButton = document.getElementById('bootstrap-admin-btn');
    if (bootstrapButton) bootstrapButton.style.display = canBootstrap && !window.isSuperAdmin ? 'block' : 'none';
};

const callableErrorCode = (error) => String(error?.code || '').replace(/^functions\//, '');

const callableErrorMessage = (error, fallback = '操作失敗，請稍後再試') => {
    const code = callableErrorCode(error);
    if (code === 'unauthenticated') return '請先登入帳號';
    if (code === 'permission-denied') return '你沒有執行這項操作的權限';
    if (code === 'already-exists') return '你已領取過這個活動的點數';
    if (code === 'not-found') return error?.message || '找不到指定資料';
    if (code === 'deadline-exceeded') return '這個 QR code 已過期';
    if (code === 'unavailable') return '目前無法連上伺服器，請檢查網路後再試';
    return error?.message || fallback;
};

const handleAuthenticatedUser = async (user) => {
    if (!user) return;
    if (currentUser?.uid === user.uid && userData) return;
    if (authenticatedUserLoadUid === user.uid && authenticatedUserLoadPromise) {
        return authenticatedUserLoadPromise;
    }

    currentUser = user;
    authenticatedUserLoadUid = user.uid;
    authenticatedUserLoadPromise = (async () => {
        try {
            const response = await callGetMyProfile();
            const result = response.data || {};
            setAdminState(result.isAdmin, result.isSuperAdmin, result.canBootstrapSuperAdmin);
            if (result.profile) {
                const data = result.profile;
                userData = {
                    ...data,
                    points: typeof data.points === 'number' ? data.points : 0,
                    history: Array.isArray(data.history) ? data.history : [],
                    avatar: data.avatar || user.photoURL || window.generateAvatarSvg((data.nickname || '你')[0], '#C66E52')
                };
                redemptionHistory = userData.history;
                activateView('view-home');
                setMainNavVisible(true);
                if (window.updatePointsUI) window.updatePointsUI();
                if (window.applyUserAvatar) window.applyUserAvatar();
                if (window.handlePendingQrFromUrl) window.handlePendingQrFromUrl();
            } else {
                userData = null;
                activateView('view-setup');
                setMainNavVisible(false);
            }
        } catch (err) {
            console.error('登入後讀取資料失敗:', err);
            if (window.showToast) window.showToast('登入成功，但讀取資料失敗，請稍後重整');
            activateView('view-login');
        }
    })();

    try {
        await authenticatedUserLoadPromise;
    } finally {
        if (authenticatedUserLoadUid === user.uid) {
            authenticatedUserLoadPromise = null;
            authenticatedUserLoadUid = null;
        }
    }
};

// --- 修正後的登入監聽邏輯 ---
onAuthStateChanged(auth, async (user) => {
    const loading = document.getElementById('loading-overlay');
    console.log('onAuthStateChanged triggered:', user ? `User: ${user.uid}, Email: ${user.email}` : 'No user');
    try {
        if (user) {
            console.log('User authenticated, processing signed-in user...');
            await handleAuthenticatedUser(user);
        } else {
            console.log('No authenticated user, showing login view');
            setAdminState(false);
            activateView('view-login');
            setMainNavVisible(false);
        }
    } catch (err) {
        console.error("初始化錯誤:", err);
        if (window.showToast) window.showToast("資料讀取失敗，請稍後再試");
        activateView('view-login');
    } finally {
        // 無論結果如何，500ms 後關閉載入畫面，避免卡死
        if (loading) setTimeout(() => { loading.style.display = 'none'; }, 500);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const accessError = sessionStorage.getItem('adminAccessError');
    if (!accessError) return;
    sessionStorage.removeItem('adminAccessError');
    const url = new URL(window.location.href);
    url.searchParams.delete('adminError');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    setTimeout(() => window.showToast(accessError), 600);
});

// ========== 帳號相關 ==========

// Google 不允許在 App 內建的 WebView 執行 OAuth。除了常見 App 標記，也要辨識
// Android WebView 的 wv / Version 4.0，以及沒有 Safari 標記的 iOS WKWebView。
const isInAppBrowser = (userAgent = navigator.userAgent) => {
    const knownInAppBrowser = /Line\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|GSA\/|Twitter|TikTok|musical_ly|BytedanceWebview|Snapchat|Pinterest|LinkedInApp|Threads/i;
    const androidWebView = /;\s*wv\)/i.test(userAgent) ||
        (/Android/i.test(userAgent) && /Version\/4\.0/i.test(userAgent));
    const iosWebView = /(iPhone|iPad|iPod)/i.test(userAgent) &&
        /AppleWebKit/i.test(userAgent) &&
        !/Safari/i.test(userAgent);

    return knownInAppBrowser.test(userAgent) || androidWebView || iosWebView;
};

const copyCurrentUrl = async () => {
    const url = window.location.href;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            return true;
        }

        const input = document.createElement('textarea');
        input.value = url;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        return copied;
    } catch (error) {
        console.error('複製網址失敗：', error);
        return false;
    }
};

const setupInAppBrowserWarning = () => {
    if (!isInAppBrowser()) return;
    const warning = document.getElementById('inapp-browser-warning');
    const loginBtn = document.getElementById('google-login-btn');
    if (warning) warning.style.display = 'block';
    if (loginBtn) loginBtn.style.display = 'none';

    const openBtn = document.getElementById('open-external-browser-btn');
    if (openBtn) {
        const isAndroid = /Android/i.test(navigator.userAgent);
        openBtn.innerText = isAndroid ? '使用 Chrome 開啟' : '複製網址';
        openBtn.onclick = async () => {
            const url = window.location.href;
            if (isAndroid && /^https?:\/\//i.test(url)) {
                const target = url.replace(/^https?:\/\//, '');
                const scheme = url.startsWith('http://') ? 'http' : 'https';
                window.location.href = `intent://${target}#Intent;scheme=${scheme};package=com.android.chrome;end`;
                return;
            }

            const copied = await copyCurrentUrl();
            if (window.showToast) {
                window.showToast(copied
                    ? '網址已複製，請貼到 Safari 或 Chrome 開啟'
                    : '請從選單選擇「使用外部瀏覽器開啟」');
            }
        };
    }
};
document.addEventListener('DOMContentLoaded', setupInAppBrowserWarning);

let googleLoginInProgress = false;

window.loginWithGoogle = async () => {
    if (isInAppBrowser()) {
        setupInAppBrowserWarning();
        if (window.showToast) window.showToast('請先在外部瀏覽器開啟本頁再登入');
        return;
    }

    if (googleLoginInProgress) return;
    googleLoginInProgress = true;

    const loading = document.getElementById('loading-overlay');
    const loginBtn = document.getElementById('google-login-btn');
    if (loading) loading.style.display = 'flex';
    if (loginBtn) loginBtn.disabled = true;

    try {
        const result = await signInWithPopup(auth, provider);
        if (result?.user) {
            await handleAuthenticatedUser(result.user);
        }
    } catch (error) {
        console.error('Google 登入失敗：', error.code, error.message);
        if (error.code === 'auth/popup-closed-by-user' ||
            error.code === 'auth/cancelled-popup-request') {
            window.showToast('Google 登入已取消');
        } else if (error.code === 'auth/popup-blocked' ||
            error.code === 'auth/operation-not-supported-in-this-environment') {
            window.showToast('瀏覽器阻擋了登入視窗，請允許彈出式視窗後再試');
        } else if (error.code === 'auth/unauthorized-domain') {
            window.showToast('目前網址尚未加入 Firebase 授權網域');
        } else {
            window.showToast(`登入初始化失敗（${error.code || '未知錯誤'}），請稍候再試。`);
        }
    } finally {
        googleLoginInProgress = false;
        if (loginBtn) loginBtn.disabled = false;
        if (loading) loading.style.display = 'none';
    }
};

window.logout = () => {
    if (window.stopQrCamera) window.stopQrCamera();
    if (!window.isGuestMode) {
        signOut(auth);
    }
    redemptionHistory = [];
    currentUser = null;
    userData = null;
    window.isGuestMode = false;
    setAdminState(false);
    localStorage.removeItem('guest_user_data');
    localStorage.removeItem('guest_redemption_history');
    activateView('view-login');
    setMainNavVisible(false);
    if (window.showToast) window.showToast('已登出，歡迎下次再來！');
};

window.bootstrapSuperAdmin = async () => {
    if (!currentUser || window.isGuestMode) {
        if (window.showToast) window.showToast('請先使用指定的 Google 帳號登入');
        return;
    }

    const button = document.getElementById('bootstrap-admin-btn');
    if (button) button.disabled = true;
    try {
        const response = await callBootstrapSuperAdmin();
        await currentUser.getIdToken(true);
        setAdminState(response.data?.isAdmin, response.data?.isSuperAdmin, false);
        if (window.showToast) window.showToast('管理員後台已啟用');
    } catch (error) {
        console.error('啟用管理員後台失敗:', error);
        if (window.showToast) window.showToast(callableErrorMessage(error, '無法啟用管理員後台'));
    } finally {
        if (button) button.disabled = false;
    }
};

window.loginAsGuest = async () => {
    window.isGuestMode = true;
    currentUser = null;
    const guestData = localStorage.getItem('guest_user_data');
    if (guestData) {
        userData = JSON.parse(guestData);
        userData.totalPoints = Math.max(Number(userData.points || 0), Number(userData.totalPoints || 0));
        redemptionHistory = JSON.parse(localStorage.getItem('guest_redemption_history') || '[]');
    } else {
        userData = {
            realName: '訪客',
            nickname: '小火花遊客',
            dept: '訪客模式',
            bio: '這是訪客測試帳號，資料只保存在這台裝置。',
            points: 0,
            totalPoints: 0,
            history: [],
            avatar: window.generateAvatarSvg('訪', '#8D63A6')
        };
        redemptionHistory = [];
    }
    activateView('view-home');
    setMainNavVisible(true);
    setAdminState(false);
    if (window.updatePointsUI) window.updatePointsUI();
    if (window.applyUserAvatar) window.applyUserAvatar();
    if (window.showToast) window.showToast('訪客資料只保存在這台裝置，不會同步到雲端。');
};

// ========== 許願池 ==========
let wishes = [];
const wishCategoryLabels = {suggestion: '建議', feedback: '回饋', curiosity: '好奇', other: '其他'};
const wishCategories = Object.keys(wishCategoryLabels);
let fallbackWishVisitorId = crypto.randomUUID();

const getWishVisitorId = () => {
    try {
        const storageKey = 'eduspark-wish-visitor-id';
        const storedId = localStorage.getItem(storageKey);
        if (storedId) return storedId;
        localStorage.setItem(storageKey, fallbackWishVisitorId);
    } catch (error) {
        console.warn('無法儲存許願池訪客識別碼：', error);
    }
    return fallbackWishVisitorId;
};

const formatWishTime = (millis) => {
    if (!millis) return '剛剛';
    return new Intl.DateTimeFormat('zh-TW', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(millis));
};

window.renderWishes = () => {
    const list = document.getElementById('wish-list');
    if (!list) return;
    const filter = document.getElementById('wish-filter')?.value || 'latest';
    let visibleWishes = filter === 'replied'
        ? wishes.filter(wish => Boolean(wish.adminReply))
        : [...wishes];
    visibleWishes.sort((a, b) => {
        if (filter === 'popular') {
            const popularityDifference = (Number(b.likesCount) || 0) - (Number(a.likesCount) || 0);
            if (popularityDifference) return popularityDifference;
        }
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });

    list.innerHTML = visibleWishes.length ? visibleWishes.map(wish => {
        const category = wishCategories.includes(wish.category) ? wish.category : 'other';
        const likesCount = Math.max(0, Number(wish.likesCount) || 0);
        return `
            <article class="wish-message-card wish-category--${category}" data-wish-id="${escapeHtml(wish.id)}">
                <div class="wish-message-meta">
                    <span><span class="wish-tag wish-category--${category}">${escapeHtml(wishCategoryLabels[category])}</span> <span class="wish-author${wish.anonymous ? ' anonymous' : ''}">${escapeHtml(wish.authorName)}</span></span>
                    <time>${escapeHtml(formatWishTime(wish.createdAt))}</time>
                </div>
                <p>${escapeHtml(wish.message)}</p>
                ${wish.adminReply ? `
                    <div class="wish-admin-reply">
                        <strong>小火花管理員回覆</strong>
                        <p>${escapeHtml(wish.adminReply)}</p>
                    </div>` : ''}
                <div class="wish-card-actions">
                    <button type="button" class="wish-like-button${wish.likedByMe ? ' liked' : ''}" aria-label="${wish.likedByMe ? '取消按讚' : '按讚'}，目前 ${likesCount} 個讚" aria-pressed="${wish.likedByMe ? 'true' : 'false'}">
                        <span class="wish-like-count">${likesCount}</span>
                        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21s-8-4.7-8-11a4.6 4.6 0 0 1 8-3.1A4.6 4.6 0 0 1 20 10c0 6.3-8 11-8 11Z"/></svg>
                    </button>
                </div>
            </article>`;
    }).join('') : `<p class="empty-history">${filter === 'replied' ? '目前還沒有管理者已回覆的留言。' : '目前還沒有留言，成為第一個留下想法的人吧！'}</p>`;
};

window.loadWishes = async () => {
    const list = document.getElementById('wish-list');
    if (!list) return;
    list.innerHTML = '<p class="empty-history">正在載入留言⋯⋯</p>';
    try {
        const response = await callListWishes({visitorId: getWishVisitorId()});
        wishes = Array.isArray(response.data) ? response.data : [];
        window.renderWishes();
    } catch (error) {
        console.error('載入許願池失敗：', error);
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, '許願池載入失敗'))}</p>`;
    }
};

document.getElementById('wish-filter')?.addEventListener('change', window.renderWishes);

document.querySelectorAll('.wish-category-button').forEach(categoryButton => {
    categoryButton.addEventListener('click', () => {
        document.querySelectorAll('.wish-category-button').forEach(button => {
            button.setAttribute('aria-pressed', String(button === categoryButton));
        });
    });
});

document.getElementById('wish-list')?.addEventListener('click', async event => {
    const likeButton = event.target.closest('.wish-like-button');
    if (!likeButton) return;
    const card = likeButton.closest('[data-wish-id]');
    if (!card || likeButton.disabled) return;
    likeButton.disabled = true;
    try {
        const result = (await callToggleWishLike({
            wishId: card.dataset.wishId,
            visitorId: getWishVisitorId()
        })).data;
        wishes = wishes.map(wish => wish.id === card.dataset.wishId
            ? {...wish, likedByMe: result.liked, likesCount: result.likesCount}
            : wish);
        window.renderWishes();
    } catch (error) {
        console.error('更新留言按讚狀態失敗：', error);
        window.showToast(callableErrorMessage(error, '按讚失敗'));
        likeButton.disabled = false;
    }
});

window.openWishPool = () => {
    setMainNavVisible(false);
    activateView('view-wishes');
    const canPost = Boolean(currentUser) && !window.isGuestMode;
    document.getElementById('wish-form').hidden = !canPost;
    document.getElementById('wish-guest-note').hidden = canPost;
    window.loadWishes();
};

const formatActivityRange = (start, end) => `${formatWishTime(start)} ～ ${formatWishTime(end)}`;
const activityCategoryLabels = {
    daily: '每日打卡',
    in_person: '實體活動',
    interactive: '互動展覽',
    limited: '限定活動'
};
const activityMapCategories = {
    daily: {title: '每日打卡', description: '每天來看看，完成打卡累積小火花。'},
    limited: {title: '限定活動', description: '期間限定的特別企劃都在這裡。'},
    in_person: {title: '活動', description: '查看近期舉辦的校園活動。'},
    interactive: {title: '展覽', description: '走進展場互動，探索教院裡的新鮮事。'}
};
let publicQrCampaigns = [];
let selectedActivityCategory = null;

window.showActivityMapPanel = () => {
    selectedActivityCategory = null;
    const mapPanel = document.getElementById('activity-map-panel');
    const categoryPanel = document.getElementById('activity-category-panel');
    if (mapPanel) mapPanel.hidden = false;
    if (categoryPanel) categoryPanel.hidden = true;
};

window.openActivityMap = () => {
    window.showActivityMapPanel();
    window.switchView('view-challenge');
};

window.openActivityCategory = (category) => {
    const categoryData = activityMapCategories[category];
    if (!categoryData) return;
    selectedActivityCategory = category;
    const mapPanel = document.getElementById('activity-map-panel');
    const categoryPanel = document.getElementById('activity-category-panel');
    if (mapPanel) mapPanel.hidden = true;
    if (categoryPanel) categoryPanel.hidden = false;
    document.getElementById('activity-category-title').textContent = categoryData.title;
    document.getElementById('activity-category-desc').textContent = categoryData.description;
    document.querySelector('.view-container').scrollTop = 0;
    window.renderActivities();
};

window.closeActivityCategory = () => {
    window.showActivityMapPanel();
    document.querySelector('.view-container').scrollTop = 0;
};

window.renderActivities = (campaigns) => {
    const list = document.getElementById('activity-list');
    if (!list) return;
    if (Array.isArray(campaigns)) publicQrCampaigns = campaigns;
    const visibleCampaigns = selectedActivityCategory
        ? publicQrCampaigns.filter(campaign => campaign.category === selectedActivityCategory)
        : [];
    list.innerHTML = visibleCampaigns.length ? visibleCampaigns.map(campaign => `
        <button class="activity-card${campaign.redeemed ? ' redeemed' : ''}" type="button" data-activity-id="${escapeHtml(campaign.id)}">
            <span class="activity-card-content">
                <span class="activity-category-tag activity-category--${escapeHtml(campaign.category || 'in_person')}">${escapeHtml(activityCategoryLabels[campaign.category] || '實體活動')}</span>
                <span class="activity-card-title">${escapeHtml(campaign.title)}</span>
                <span>${escapeHtml(formatActivityRange(campaign.startsAt, campaign.endsAt))}</span>
                <span class="activity-card-points">${campaign.redeemed ? '已獲得' : '完成可獲得'} ${Number(campaign.points)} 點</span>
            </span>
            ${campaign.redeemed ? `
                <span class="activity-redeemed-check" aria-label="已兌換" title="已兌換">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m7 12.5 3.2 3.2L17.5 8.5"/>
                    </svg>
                </span>` : ''}
        </button>`).join('') : `
            <div class="activity-empty-state">
                <img class="activity-empty-watermark" src="spark2.png" alt="" aria-hidden="true">
                <p>敬請期待！</p>
            </div>`;
    list.querySelectorAll('[data-activity-id]').forEach(button => {
        button.addEventListener('click', () => {
            const campaign = visibleCampaigns.find(item => item.id === button.dataset.activityId);
            if (campaign) window.openActivityDetail(campaign);
        });
    });
};

window.loadActivities = async () => {
    const list = document.getElementById('activity-list');
    if (!list) return;
    list.innerHTML = '<p class="empty-history">正在載入活動⋯⋯</p>';
    try {
        const response = await callListPublicQrCampaigns();
        publicQrCampaigns = Array.isArray(response.data) ? response.data : [];
        window.renderActivities();
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, '活動載入失敗'))}</p>`;
    }
};

window.openActivityDetail = (campaign) => {
    document.getElementById('activity-detail-content').innerHTML = `
        <header class="activity-detail-header">
            <p class="wish-eyebrow">活動詳情</p>
            <h2>${escapeHtml(campaign.title)}</h2>
            <span class="activity-category-tag activity-category--${escapeHtml(campaign.category || 'in_person')}">${escapeHtml(activityCategoryLabels[campaign.category] || '實體活動')}</span>
            <p class="activity-detail-time">${escapeHtml(formatActivityRange(campaign.startsAt, campaign.endsAt))}</p>
        </header>
        <div class="activity-detail-description">${escapeHtml(campaign.description || '尚無活動說明')}</div>
        <p class="activity-card-points activity-detail-points">完成可獲得 ${Number(campaign.points)} 點</p>`;
    document.getElementById('activity-detail').classList.add('active');
    document.getElementById('activity-detail-overlay').classList.add('active');
};

window.closeActivityDetail = () => {
    document.getElementById('activity-detail')?.classList.remove('active');
    document.getElementById('activity-detail-overlay')?.classList.remove('active');
};

const pointHistoryTypeLabels = {
    qr: '活動兌換',
    reward: '獎勵兌換',
    admin: '管理員調整'
};

window.renderPointHistory = (history) => {
    const list = document.getElementById('point-history-list');
    if (!list) return;
    list.innerHTML = history.length ? history.map(item => {
        const type = Object.hasOwn(pointHistoryTypeLabels, item.type) ? item.type : 'other';
        const typeLabel = pointHistoryTypeLabels[type] || '積分異動';
        return `
            <article class="point-history-item">
                <div>
                    <span class="point-history-title-row">
                        <strong>${escapeHtml(item.label)}</strong>
                        <span class="point-history-tag ${escapeHtml(type)}">${escapeHtml(typeLabel)}</span>
                    </span>
                    <time>${escapeHtml(formatWishTime(item.createdAt))}</time>
                </div>
                <span class="point-delta ${Number(item.delta) >= 0 ? 'positive' : 'negative'}">${Number(item.delta) >= 0 ? '+' : ''}${Number(item.delta)}</span>
            </article>`;
    }).join('') : '<p class="empty-history">目前還沒有積分異動紀錄。</p>';
};

window.loadPointHistory = async () => {
    const list = document.getElementById('point-history-list');
    if (!list) return;
    if (!currentUser || window.isGuestMode) {
        list.innerHTML = '<p class="empty-history">訪客模式不會同步積分紀錄。</p>';
        return;
    }
    list.innerHTML = '<p class="empty-history">正在載入紀錄⋯⋯</p>';
    try {
        const response = await callGetPointHistory();
        const history = Array.isArray(response.data) ? response.data : [];
        window.renderPointHistory(history);
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, '積分紀錄載入失敗'))}</p>`;
    }
};

window.openPointHistory = () => {
    window.switchView('view-point-history');
    window.loadPointHistory();
};

// ========== 公佈欄 ==========
const announcementCategoryLabels = {
    general: '重要公告',
    event: '活動消息',
    update: '功能更新',
    reward: '兌換活動'
};
let publishedAnnouncements = [];

const plainAnnouncementHtml = (content) => escapeHtml(content).replaceAll('\n', '<br>');

window.renderAnnouncements = () => {
    const list = document.getElementById('announcement-list');
    if (!list) return;
    const selectedCategory = document.getElementById('announcement-filter')?.value || 'all';
    const announcements = selectedCategory === 'all'
        ? publishedAnnouncements
        : publishedAnnouncements.filter(announcement => announcement.category === selectedCategory);
    if (!announcements.length) {
        list.innerHTML = `
            <div class="announcement-empty">
                <img src="spark1.png" alt="小火花">
                <h3>${publishedAnnouncements.length ? '此類型目前沒有公告' : '敬請期待'}</h3>
            </div>`;
        return;
    }
    list.innerHTML = announcements.map(announcement => `
        <article class="announcement-card announcement-${escapeHtml(announcement.category)}">
            <div class="announcement-meta">
                <span>${escapeHtml(announcementCategoryLabels[announcement.category] || '重要公告')}</span>
                <time>${escapeHtml(formatWishTime(announcement.updatedAt))}</time>
            </div>
            <h3>${escapeHtml(announcement.title)}</h3>
            <div class="announcement-rich-content">${announcement.contentHtml || plainAnnouncementHtml(announcement.content)}</div>
        </article>
    `).join('');
};

window.loadAnnouncements = async () => {
    const list = document.getElementById('announcement-list');
    if (!list) return;
    list.innerHTML = '<p class="empty-history">正在載入公告⋯⋯</p>';
    try {
        const response = await callListPublishedAnnouncements();
        publishedAnnouncements = Array.isArray(response.data) ? response.data : [];
        window.renderAnnouncements();
    } catch (error) {
        console.error('載入公佈欄失敗：', error);
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, '公佈欄載入失敗'))}</p>`;
    }
};

document.getElementById('announcement-filter')?.addEventListener('change', window.renderAnnouncements);

document.getElementById('wish-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('wish-message');
    const button = document.getElementById('send-wish-btn');
    const message = input.value.trim();
    const selectedCategory = document.querySelector('.wish-category-button[aria-pressed="true"]')?.dataset.category;
    if (!selectedCategory) {
        window.showToast('請選擇本留言的主題類別');
        document.querySelector('.wish-category-button')?.focus();
        return;
    }
    if (!message) {
        window.showToast('請先輸入留言內容');
        input.focus();
        return;
    }
    button.disabled = true;
    try {
        await callCreateWish({
            message,
            anonymous: document.getElementById('wish-anonymous').checked,
            category: selectedCategory
        });
        input.value = '';
        document.querySelectorAll('.wish-category-button').forEach(categoryButton => categoryButton.setAttribute('aria-pressed', 'false'));
        window.showToast('留言已送出');
        await window.loadWishes();
    } catch (error) {
        console.error('送出許願池留言失敗：', error);
        window.showToast(callableErrorMessage(error, '留言送出失敗'));
    } finally {
        button.disabled = false;
    }
});

// ========== 建立個人檔案 ==========
let setupInProgress = false;

window.completeSetup = async () => {
    if (setupInProgress) return;

    const realName = document.getElementById('setup-realname')?.value.trim() || '';
    const nickname = document.getElementById('setup-nickname')?.value.trim() || '';
    const dept = document.getElementById('setup-dept')?.value.trim() || '';
    const bio = document.getElementById('setup-bio')?.value.trim() || '';

    if (!realName || !nickname) {
        window.showToast('請填寫真實姓名與公開暱稱');
        return;
    }
    if (!currentUser) {
        window.showToast('登入狀態已失效，請重新登入');
        activateView('view-login');
        setMainNavVisible(false);
        return;
    }

    setupInProgress = true;
    const setupButton = document.getElementById('complete-setup-btn');
    const loading = document.getElementById('loading-overlay');
    if (setupButton) setupButton.disabled = true;
    if (loading) loading.style.display = 'flex';

    try {
        const avatar = currentUser.photoURL || window.generateAvatarSvg(nickname.charAt(0) || '火', window.defaultAvatarBackgroundColor);
        const response = await callSaveProfile({
            realName,
            nickname,
            dept,
            bio,
            avatar
        });
        userData = {...response.data, history: []};
        redemptionHistory = [];

        setMainNavVisible(true);
        activateView('view-home');
        window.updatePointsUI();
        window.applyUserAvatar();
        window.showToast('個人檔案已建立！');
        if (window.handlePendingQrFromUrl) window.handlePendingQrFromUrl();
    } catch (error) {
        console.error('建立個人檔案失敗：', error);
        window.showToast(callableErrorMessage(error, '個人檔案儲存失敗，請確認網路連線後再試'));
    } finally {
        setupInProgress = false;
        if (setupButton) setupButton.disabled = false;
        if (loading) loading.style.display = 'none';
    }
};

// ========== 更新個人資料 ==========
window.updateProfile = async () => {
    const realName = document.getElementById('edit-realname').value.trim();
    const nickname = document.getElementById('edit-nickname').value.trim();
    const dept     = document.getElementById('edit-dept').value.trim();
    const bio      = document.getElementById('edit-bio').value.trim();
    const preview  = document.getElementById('edit-avatar-preview');
    const updatedAvatar = preview?.src || userData.avatar;
    if (!realName || !nickname) {
        window.showToast('請填寫真實姓名與公開暱稱');
        return;
    }
    if (window.isGuestMode) {
        userData = { ...userData, realName, nickname, dept, bio, avatar: updatedAvatar };
        localStorage.setItem('guest_user_data', JSON.stringify(userData));
    } else {
        try {
            const response = await callSaveProfile({realName, nickname, dept, bio, avatar: updatedAvatar});
            userData = {...userData, ...response.data};
        } catch (error) {
            console.error('更新個人檔案失敗：', error);
            window.showToast(callableErrorMessage(error, '個人檔案修改失敗'));
            return;
        }
    }
    window.showToast('修改成功！');
    window.switchView('view-home');
    window.applyUserAvatar();
};

// ========== 獲得積分 ==========
window.earnPoints = async (btnElement, pointsToAdd, taskName) => {
    if (btnElement.classList.contains('completed')) return;

    if (!window.isGuestMode) {
        window.openQrScanner();
        return;
    }

    userData.points += pointsToAdd;
    userData.totalPoints = Math.max(Number(userData.totalPoints || 0), userData.points - pointsToAdd) + pointsToAdd;
    localStorage.setItem('guest_user_data', JSON.stringify(userData));

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
    if (!window.isGuestMode) {
        window.showToast('正式帳號的積分不能自行重置');
        return;
    }
    userData.points = 0;
    localStorage.setItem('guest_user_data', JSON.stringify(userData));
    window.updatePointsUI();
    window.showToast('積分已歸零重置！');
};

// ========== 兌換獎勵 ==========
const rewardCatalog = {
    starbucks: {name: '星巴克一杯', cost: 10},
    sevenEleven100: {name: '7-11 100 元禮品券', cost: 20},
    microCredit02: {name: '0.2 微學分', cost: 30}
};
let rewardRedemptionInProgress = false;

window.redeemReward = async (rewardId) => {
    if (rewardRedemptionInProgress) return;
    const reward = rewardCatalog[rewardId];
    if (!reward) return window.showToast('找不到這個獎勵項目');

    if (window.isGuestMode) {
        if (userData.points < reward.cost) {
            return window.showToast(`積分不足喔！還差 ${reward.cost - userData.points} 點才能兌換`);
        }
        userData.points -= reward.cost;
        redemptionHistory.unshift({name: reward.name, time: Date.now(), cost: reward.cost});
        userData.history = redemptionHistory;
        localStorage.setItem('guest_user_data', JSON.stringify(userData));
        localStorage.setItem('guest_redemption_history', JSON.stringify(redemptionHistory));
        window.updatePointsUI();
        window.renderHistory();
        return window.showToast(`成功兌換「${reward.name}」！已扣除 ${reward.cost} 點`);
    }

    rewardRedemptionInProgress = true;
    try {
        const response = await callRedeemReward({rewardId});
        userData.points = response.data.points;
        redemptionHistory.unshift({
            id: response.data.redemptionId,
            name: response.data.reward.name,
            cost: response.data.reward.cost,
            time: Date.now()
        });
        userData.history = redemptionHistory;
        window.updatePointsUI();
        window.renderHistory();
        window.showToast(`成功兌換「${response.data.reward.name}」！已扣除 ${response.data.reward.cost} 點`);
    } catch (error) {
        console.error('兌換獎勵失敗：', error);
        const shortage = error?.details?.shortage;
        window.showToast(shortage ? `積分不足喔！還差 ${shortage} 點才能兌換` : callableErrorMessage(error, '獎勵兌換失敗'));
    } finally {
        rewardRedemptionInProgress = false;
    }
};

// ========== 歷史紀錄 ==========
window.renderHistory = () => {
    const container = document.getElementById('history-container');
    if (redemptionHistory.length === 0) {
        container.innerHTML = "<p class='empty-history'>尚無兌換紀錄，快去闖關累積點數吧！</p>";
        window.updateHistorySummary();
        return;
    }
    container.innerHTML = redemptionHistory.map(item => {
        const cost = window.parseRedeemCost(item);
        const costLabel = cost > 0 ? `（-${cost}點）` : '';
        const itemTime = typeof item.time === 'number' ? new Date(item.time) : null;
        const timeLabel = itemTime && !Number.isNaN(itemTime.getTime())
            ? `${itemTime.getMonth()+1}/${itemTime.getDate()} ${String(itemTime.getHours()).padStart(2,'0')}:${String(itemTime.getMinutes()).padStart(2,'0')}`
            : item.time || '';
        return `
            <div class="history-item">
                <span class="history-name">${escapeHtml(item.name)}${costLabel}</span>
                <span class="history-time">${escapeHtml(timeLabel)}</span>
            </div>
        `;
    }).join('');
    window.updateHistorySummary();
};

window.clearHistory = async () => {
    if (redemptionHistory.length === 0) {
        window.showToast('目前沒有紀錄可以清空喔！');
        return;
    }
    if (!window.isGuestMode) {
        window.showToast('正式帳號的兌換紀錄會保留供核對，無法清除');
        return;
    }
    redemptionHistory = [];
    userData.history = [];
    localStorage.setItem('guest_user_data', JSON.stringify(userData));
    localStorage.setItem('guest_redemption_history', JSON.stringify(redemptionHistory));
    window.renderHistory();
    window.showToast('歷史紀錄已清空！');
};

// ========== 排行榜 ==========
window.fetchLeaderboard = async () => {
    const list = document.getElementById('leaderboard-list');
    if (window.isGuestMode) {
        list.innerHTML = `
            <div class="guest-ranking-message">
                <p class="empty-history">訪客模式下無法查看排行榜，<br>請登入帳號查看完整社群排行。</p>
                <button class="guest-login-btn" onclick="window.loginWithGoogle()">使用 Google 帳號登入</button>
            </div>
        `;
        return;
    }
    const rankingField = window.leaderboardMode === 'total' ? 'totalPoints' : 'points';
    const snap = await getDocs(query(collection(db, "users"), orderBy(rankingField, 'desc'), limit(100)));
    const users = [];
    snap.forEach(d => {
        const data = d.data();
        const isMe = d.id === currentUser?.uid;
        const totalPoints = Math.max(Number(data.points || 0), Number(data.totalPoints || data.points || 0));
        const redeemed = Math.max(0, totalPoints - Number(data.points || 0));
        const avatarUrl = safeImageUrl(data.avatar || data.photoURL || data.avatarUrl)
            || window.generateAvatarSvg(data.nickname?.[0] || '友', '#758A93');
        const profile = window.getSocialUserDisplayData({ ...data, avatar: avatarUrl, points: data.points, redeemed, totalPoints });
        users.push({ id: d.id, ...data, ...profile, avatar: avatarUrl, isMe, redeemed, totalPoints });
    });

    if (window.leaderboardMode === 'current') {
        users.sort((a, b) => (Number(b.points || 0) - Number(a.points || 0)));
    } else {
        users.sort((a, b) => (Number(b.totalPoints || 0) - Number(a.totalPoints || 0)));
    }

    window.renderLeaderboardUsers(users);
};

window.renderLeaderboardUsers = (users = []) => {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;

    window.leaderboardUsers = users;

    list.innerHTML = '';
    let rank = 1;
    users.forEach(user => {
        const pointsToShow = window.leaderboardMode === 'total' ? user.totalPoints : Number(user.points || 0);
        const redeemedLabel = window.leaderboardMode === 'total' && user.redeemed > 0 ? `<span class="user-redeemed-tag">-${user.redeemed}點</span>` : '';
        list.innerHTML += `
            <div class="leaderboard-item ${user.isMe ? 'leaderboard-item-me' : ''}">
                <div class="rank-badge">${rank++}</div>
                <button type="button" class="leader-avatar-wrapper" data-user-id="${escapeHtml(user.id)}" aria-label="查看 ${escapeHtml(user.nickname)} 的個人資訊">
                    <img src="${escapeHtml(user.avatar)}" class="leader-avatar" alt="${escapeHtml(user.nickname)} 頭像">
                </button>
                <div class="user-details">
                    <div class="user-name-tag">${escapeHtml(user.nickname)}${user.isMe ? ' <span class="me-badge">（我）</span>' : ''}</div>
                    <div class="user-dept-tag">${escapeHtml(user.dept || '教院小夥伴')}</div>
                </div>
                <div class="leaderboard-points-group">
                    ${redeemedLabel}
                    <div class="user-points-tag">${pointsToShow}點</div>
                </div>
            </div>`;
    });
    list.querySelectorAll('.leader-avatar-wrapper').forEach(item => {
        item.addEventListener('click', () => window.showSocialDetail(item.dataset.userId));
    });
};

// ========== QR code 掃描與兌換 ==========
let qrMediaStream = null;
let qrAnimationFrame = null;
let qrLastFrameAt = 0;
let qrRedemptionInProgress = false;

const setScannerStatus = (message) => {
    const status = document.getElementById('scanner-status');
    if (status) status.innerText = message;
};

const setScannerRestartVisible = (visible) => {
    const button = document.getElementById('restart-scanner-btn');
    if (button) button.style.display = visible ? 'block' : 'none';
};

const extractCampaignId = (value) => {
    const rawValue = String(value || '').trim();
    if (/^[a-f0-9]{36}$/.test(rawValue)) return rawValue;
    try {
        const url = new URL(rawValue);
        const allowedHosts = new Set([
            window.location.hostname,
            'coespark-a3f6e.web.app',
            'coespark-a3f6e.firebaseapp.com'
        ]);
        if (!allowedHosts.has(url.hostname)) return null;
        const campaignId = url.searchParams.get('redeem') || '';
        return /^[a-f0-9]{36}$/.test(campaignId) ? campaignId : null;
    } catch {
        return null;
    }
};

window.stopQrCamera = () => {
    if (qrAnimationFrame) cancelAnimationFrame(qrAnimationFrame);
    qrAnimationFrame = null;
    if (qrMediaStream) qrMediaStream.getTracks().forEach(track => track.stop());
    qrMediaStream = null;
    const video = document.getElementById('qr-video');
    if (video) video.srcObject = null;
};

window.redeemQrCampaign = async (campaignId) => {
    if (qrRedemptionInProgress) return;
    const normalizedId = extractCampaignId(campaignId);
    if (!normalizedId) {
        setScannerStatus('這不是教院小火花的活動 QR code。');
        setScannerRestartVisible(true);
        return;
    }

    qrRedemptionInProgress = true;
    window.stopQrCamera();
    setScannerRestartVisible(false);
    setScannerStatus('正在確認活動與領取資格⋯⋯');
    try {
        const response = await callRedeemQr({campaignId: normalizedId});
        userData.points = response.data.points;
        userData.totalPoints = response.data.totalPoints;
        window.updatePointsUI();
        setScannerStatus(`成功完成「${response.data.title}」，獲得 ${response.data.earned} 點！`);
        window.showToast(`獲得 ${response.data.earned} 點！`);
        const url = new URL(window.location.href);
        url.searchParams.delete('redeem');
        window.history.replaceState({}, '', url);
        setTimeout(() => {
            setMainNavVisible(true);
            window.switchView('view-home');
        }, 1600);
    } catch (error) {
        console.error('QR code 兌換失敗：', error);
        const message = callableErrorMessage(error, '無法領取活動點數');
        setScannerStatus(message);
        window.showToast(message);
        setScannerRestartVisible(true);
    } finally {
        qrRedemptionInProgress = false;
    }
};

const scanVideoFrame = (timestamp) => {
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    if (!qrMediaStream || !video || !canvas) return;
    qrAnimationFrame = requestAnimationFrame(scanVideoFrame);
    if (timestamp - qrLastFrameAt < 180 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    qrLastFrameAt = timestamp;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context.drawImage(video, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const result = window.jsQR?.(imageData.data, width, height, {inversionAttempts: 'dontInvert'});
    if (result?.data) window.redeemQrCampaign(result.data);
};

window.startQrCamera = async () => {
    if (qrRedemptionInProgress) return;
    window.stopQrCamera();
    setScannerRestartVisible(false);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setScannerStatus('目前瀏覽器無法開啟相機，請改用 HTTPS 網址或從相簿選擇 QR code。');
        setScannerRestartVisible(true);
        return;
    }
    if (typeof window.jsQR !== 'function') {
        setScannerStatus('QR code 掃描元件載入失敗，請重新開啟頁面後再試。');
        setScannerRestartVisible(true);
        return;
    }

    setScannerStatus('請允許網站使用相機。');
    try {
        qrMediaStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 1280}}
        });
        const video = document.getElementById('qr-video');
        video.srcObject = qrMediaStream;
        await video.play();
        setScannerStatus('請將 QR code 對準框內。');
        qrAnimationFrame = requestAnimationFrame(scanVideoFrame);
    } catch (error) {
        console.error('開啟相機失敗：', error);
        const message = error?.name === 'NotAllowedError'
            ? '相機權限被拒絕，請在瀏覽器設定中允許相機，或從相簿選擇 QR code。'
            : '無法開啟相機，請從相簿選擇 QR code。';
        setScannerStatus(message);
        setScannerRestartVisible(true);
    }
};

window.openQrScanner = () => {
    if (window.isGuestMode || !currentUser) {
        window.showToast('請先使用 Google 帳號登入，才能領取活動點數');
        return;
    }
    activateView('view-scanner');
    setMainNavVisible(false);
    window.startQrCamera();
};

window.closeQrScanner = () => {
    window.stopQrCamera();
    setMainNavVisible(true);
    window.switchView('view-home');
};

window.handlePendingQrFromUrl = () => {
    if (!currentUser || !userData || window.isGuestMode) return;
    const campaignId = new URL(window.location.href).searchParams.get('redeem');
    if (!campaignId) return;
    activateView('view-scanner');
    setMainNavVisible(false);
    window.redeemQrCampaign(campaignId);
};

const decodeQrImage = async (file) => {
    if (!file || typeof window.jsQR !== 'function') return null;
    const bitmap = await createImageBitmap(file);
    const canvas = document.getElementById('qr-canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    return window.jsQR(imageData.data, canvas.width, canvas.height)?.data || null;
};

document.addEventListener('DOMContentLoaded', () => {
    const imageInput = document.getElementById('qr-image-input');
    imageInput?.addEventListener('change', async () => {
        const file = imageInput.files?.[0];
        if (!file) return;
        try {
            setScannerStatus('正在辨識圖片⋯⋯');
            const result = await decodeQrImage(file);
            if (result) {
                window.redeemQrCampaign(result);
            } else {
                setScannerStatus('圖片中找不到 QR code，請換一張清楚的圖片。');
            }
        } catch (error) {
            console.error('辨識 QR code 圖片失敗：', error);
            setScannerStatus('無法讀取這張圖片，請換一張圖片再試。');
        } finally {
            imageInput.value = '';
        }
    });
});

// ========== 管理員 QR code 管理 ==========
let currentQrDownload = null;

const toLocalDateTimeInput = (date) => {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
};

const formatCampaignTime = (millis) => {
    if (!millis) return '未設定';
    return new Intl.DateTimeFormat('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    }).format(new Date(millis));
};

const showQrPreview = (campaign) => {
    currentQrDownload = campaign;
    document.getElementById('qr-preview-card').style.display = 'block';
    document.getElementById('qr-preview-title').innerText = `${campaign.title} QR code`;
    document.getElementById('qr-preview-image').innerHTML = campaign.svg;
    const link = document.getElementById('qr-preview-url');
    link.href = campaign.url;
    link.innerText = campaign.url;
    document.getElementById('qr-preview-card').scrollIntoView({behavior: 'smooth', block: 'start'});
};

window.downloadCurrentQr = () => {
    if (!currentQrDownload?.pngDataUrl) return;
    const link = document.createElement('a');
    link.href = currentQrDownload.pngDataUrl;
    link.download = `${currentQrDownload.title || '活動'}-QR-code.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
};

window.openAdminView = () => {
    if (!window.isAdmin) {
        window.showToast('你沒有管理員權限');
        return;
    }
    const start = new Date();
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    document.getElementById('admin-campaign-start').value ||= toLocalDateTimeInput(start);
    document.getElementById('admin-campaign-end').value ||= toLocalDateTimeInput(end);
    setMainNavVisible(false);
    activateView('view-admin');
    window.loadQrCampaigns();
};

window.createQrCampaign = async () => {
    if (!window.isAdmin) return window.showToast('你沒有管理員權限');
    const title = document.getElementById('admin-campaign-title').value.trim();
    const points = Number(document.getElementById('admin-campaign-points').value);
    const startsAt = new Date(document.getElementById('admin-campaign-start').value).getTime();
    const endsAt = new Date(document.getElementById('admin-campaign-end').value).getTime();
    if (!title || !Number.isInteger(points) || !startsAt || !endsAt) {
        window.showToast('請完整填寫活動名稱、點數與時間');
        return;
    }
    const button = document.getElementById('create-campaign-btn');
    button.disabled = true;
    try {
        const response = await callCreateQrCampaign({title, points, startsAt, endsAt});
        showQrPreview(response.data);
        document.getElementById('admin-campaign-title').value = '';
        window.showToast('活動 QR code 已建立');
        await window.loadQrCampaigns();
    } catch (error) {
        console.error('建立 QR code 失敗：', error);
        window.showToast(callableErrorMessage(error, '建立 QR code 失敗'));
    } finally {
        button.disabled = false;
    }
};

window.loadQrCampaigns = async () => {
    if (!window.isAdmin) return;
    const list = document.getElementById('admin-campaign-list');
    list.innerHTML = '<p class="empty-history">正在載入活動⋯⋯</p>';
    try {
        const response = await callListQrCampaigns();
        const campaigns = Array.isArray(response.data) ? response.data : [];
        if (campaigns.length === 0) {
            list.innerHTML = '<p class="empty-history">尚未建立活動 QR code。</p>';
            return;
        }
        list.innerHTML = campaigns.map(campaign => `
            <div class="campaign-item">
                <div class="campaign-item-heading">
                    <div class="campaign-title">${escapeHtml(campaign.title)}</div>
                    <span class="campaign-status ${campaign.active ? 'active' : ''}">${campaign.active ? '啟用中' : '已停用'}</span>
                </div>
                <div class="campaign-meta">
                    ${campaign.points} 點<br>
                    ${formatCampaignTime(campaign.startsAt)}～${formatCampaignTime(campaign.endsAt)}
                </div>
                <div class="campaign-actions">
                    <button class="small-action-btn" onclick="window.showCampaignQr('${campaign.id}')">查看 QR code</button>
                    <button class="small-action-btn" onclick="window.toggleCampaign('${campaign.id}', ${!campaign.active})">${campaign.active ? '停用' : '重新啟用'}</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('載入活動列表失敗：', error);
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, '活動列表載入失敗'))}</p>`;
    }
};

window.showCampaignQr = async (campaignId) => {
    try {
        const response = await callGetQrCampaign({campaignId});
        showQrPreview(response.data);
    } catch (error) {
        console.error('取得 QR code 失敗：', error);
        window.showToast(callableErrorMessage(error, '無法取得 QR code'));
    }
};

window.toggleCampaign = async (campaignId, active) => {
    if (!window.isAdmin) return;
    try {
        await callSetQrCampaignStatus({campaignId, active});
        window.showToast(active ? '活動已重新啟用' : '活動已停用');
        await window.loadQrCampaigns();
    } catch (error) {
        console.error('更新活動狀態失敗：', error);
        window.showToast(callableErrorMessage(error, '活動狀態更新失敗'));
    }
};

// ========== 管理員角色管理 ==========
let selectedAdminUser = null;

const renderAdminUser = (user) => {
    const container = document.getElementById('admin-user-result');
    if (!container) return;
    if (!user) {
        container.innerHTML = '';
        return;
    }
    const roleLabel = user.isAdmin ? '管理員' : '一般使用者';
    const actionDisabled = user.isSuperAdmin || user.disabled;
    const actionLabel = user.isAdmin ? '撤銷管理員' : '設為管理員';
    container.innerHTML = `
        <div class="campaign-item role-user-item">
            <div class="campaign-item-heading">
                <div>
                    <div class="campaign-title">${escapeHtml(user.displayName || user.email)}</div>
                    <div class="campaign-meta">${escapeHtml(user.email)}<br>${escapeHtml(roleLabel)}${user.disabled ? '・帳號已停用' : ''}</div>
                </div>
                <span class="campaign-status ${user.isAdmin ? 'active' : ''}">${escapeHtml(roleLabel)}</span>
            </div>
            <div class="campaign-actions">
                <button class="small-action-btn" onclick="window.setSelectedAdminRole(${!user.isAdmin})" ${actionDisabled ? 'disabled' : ''}>${actionLabel}</button>
            </div>
        </div>`;
};

window.openAdminRoleView = () => {
    if (!window.isSuperAdmin) {
        window.showToast('你沒有管理管理員的權限');
        return;
    }
    selectedAdminUser = null;
    renderAdminUser(null);
    setMainNavVisible(false);
    activateView('view-admin-roles');
    window.loadAdminUsers();
};

window.lookupAdminUser = async () => {
    if (!window.isSuperAdmin) return;
    const input = document.getElementById('admin-user-email');
    const email = input.value.trim();
    if (!email) return window.showToast('請輸入電子郵件');
    const button = document.getElementById('lookup-admin-user-btn');
    button.disabled = true;
    try {
        const response = await callLookupAdminUser({email});
        selectedAdminUser = response.data;
        renderAdminUser(selectedAdminUser);
    } catch (error) {
        selectedAdminUser = null;
        renderAdminUser(null);
        window.showToast(callableErrorMessage(error, '查詢使用者失敗'));
    } finally {
        button.disabled = false;
    }
};

window.setSelectedAdminRole = async (admin) => {
    if (!window.isSuperAdmin || !selectedAdminUser?.email) return;
    if (!admin && !window.confirm(`確定要撤銷 ${selectedAdminUser.email} 的管理員權限嗎？`)) return;
    try {
        const response = await callSetAdminRole({email: selectedAdminUser.email, admin});
        selectedAdminUser = response.data;
        renderAdminUser(selectedAdminUser);
        window.showToast(admin
            ? '已授予管理員權限，請通知對方登出後重新登入'
            : '已撤銷管理員權限，最慢會在登入憑證更新後生效');
        await window.loadAdminUsers();
    } catch (error) {
        window.showToast(callableErrorMessage(error, '更新管理員權限失敗'));
    }
};

window.loadAdminUsers = async () => {
    if (!window.isSuperAdmin) return;
    const list = document.getElementById('admin-user-list');
    list.innerHTML = '<p class="empty-history">正在載入管理員⋯⋯</p>';
    try {
        const response = await callListAdminUsers();
        const users = Array.isArray(response.data) ? response.data : [];
        list.innerHTML = users.length ? users.map(user => {
            const roleLabel = '管理員';
            return `
                <div class="campaign-item role-user-item">
                    <div class="campaign-item-heading">
                        <div>
                            <div class="campaign-title">${escapeHtml(user.displayName || user.email)}</div>
                            <div class="campaign-meta">${escapeHtml(user.email)}</div>
                        </div>
                        <span class="campaign-status active">${escapeHtml(roleLabel)}</span>
                    </div>
                    ${user.isSuperAdmin ? '' : `<div class="campaign-actions"><button class="small-action-btn role-manage-btn" data-email="${escapeHtml(user.email)}">管理權限</button></div>`}
                </div>`;
        }).join('') : '<p class="empty-history">目前沒有其他管理員。</p>';
        list.querySelectorAll('.role-manage-btn').forEach(button => {
            button.addEventListener('click', () => {
                document.getElementById('admin-user-email').value = button.dataset.email || '';
                window.lookupAdminUser();
            });
        });
    } catch (error) {
        list.innerHTML = `<p class="empty-history">${escapeHtml(callableErrorMessage(error, '管理員列表載入失敗'))}</p>`;
    }
};

// ========== 視圖切換 ==========
window.navTo = (viewId, el) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    window.switchView(viewId);
};

window.switchView = (viewId) => {
    if (viewId !== 'view-scanner' && window.stopQrCamera) window.stopQrCamera();
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    document.querySelector('.view-container').scrollTop = 0;
    window.closeSocialDetail();
    window.closeActivityDetail();
    if (['view-reward', 'view-home', 'view-social'].includes(viewId)) {
        setActiveNavItem(viewId);
    }
    if (['view-scanner', 'view-wishes', 'view-admin', 'view-admin-roles', 'view-login', 'view-setup'].includes(viewId)) {
        setMainNavVisible(false);
    } else if (userData) {
        setMainNavVisible(true);
    }

    if (viewId === 'view-social')  window.fetchLeaderboard();
    if (viewId === 'view-reward') window.loadAnnouncements();
    if (viewId === 'view-challenge') window.loadActivities();
    if (viewId === 'view-profile' && userData) {
        document.getElementById('edit-realname').value = userData.realName  || '';
        document.getElementById('edit-nickname').value = userData.nickname  || '';
        document.getElementById('edit-dept').value     = userData.dept      || '';
        document.getElementById('edit-bio').value      = userData.bio       || '';
        document.getElementById('edit-avatar-preview').src = userData.avatar || window.generateAvatarSvg(userData.nickname?.[0] || '你', window.defaultAvatarBackgroundColor);
        if (!window.nicknameAvatarInputListenerAdded) {
            const nicknameInput = document.getElementById('edit-nickname');
            if (nicknameInput) {
                nicknameInput.addEventListener('input', () => {
                    window.renderAvatarOptions();
                });
                window.nicknameAvatarInputListenerAdded = true;
            }
        }
        if (!window.bioCountInputListenerAdded) {
            const bioInput = document.getElementById('edit-bio');
            if (bioInput) {
                bioInput.addEventListener('input', window.updateBioCount);
                window.bioCountInputListenerAdded = true;
            }
        }
        window.initAvatarSelectionFromNickname(userData.nickname || '你');
        window.renderAvatarOptions();
        window.updateBioCount();
        window.closeAvatarSettings();
    }
};

// ========== UI 更新 ==========
window.updatePointsUI = () => {
    const pts = userData ? userData.points : 0;
    const totalPoints = userData ? Math.max(Number(userData.totalPoints || 0), Number(pts || 0)) : 0;
    document.querySelectorAll('.global-points').forEach(el => el.innerText = pts);
    window.renderSparkLevel(totalPoints);
    const resetScoreButton = document.getElementById('reset-score-btn');
    const clearHistoryButton = document.getElementById('clear-history-btn');
    if (resetScoreButton) resetScoreButton.style.display = window.isGuestMode ? 'inline-flex' : 'none';
    if (clearHistoryButton) clearHistoryButton.style.display = window.isGuestMode ? 'inline-flex' : 'none';
    window.applyUserAvatar();
};

window.applyUserAvatar = () => {
    const avatarUrl = safeImageUrl(userData?.avatar || currentUser?.photoURL)
        || window.generateAvatarSvg(userData?.nickname?.[0] || '你', window.defaultAvatarBackgroundColor);
    const homeAvatar = document.getElementById('home-avatar');
    const profilePreview = document.getElementById('edit-avatar-preview');
    if (homeAvatar) homeAvatar.src = avatarUrl;
    if (profilePreview) profilePreview.src = avatarUrl;
};

window.showComingSoon = () => window.showToast('敬請期待！');

window.showTeamIntro = () => {
    const overlay = document.getElementById('team-intro-overlay');
    const modal = document.getElementById('team-intro-modal');
    if (overlay) overlay.classList.add('active');
    if (modal) modal.classList.add('active');
};

window.closeTeamIntro = () => {
    const overlay = document.getElementById('team-intro-overlay');
    const modal = document.getElementById('team-intro-modal');
    if (overlay) overlay.classList.remove('active');
    if (modal) modal.classList.remove('active');
};


// ========== Toast 通知 ==========
let toastTimeout;
window.showToast = (msg) => {
    const t = document.getElementById('toast');
    t.textContent = String(msg ?? '');
    t.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => t.classList.remove('show'), 2500);
};

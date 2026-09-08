import {expect, test} from '@playwright/test';

const openApp = async (page) => {
    await page.goto('/');
    await expect(page.locator('#loading-overlay')).toBeHidden();
};

test('訪客可以進入首頁', async ({page}) => {
    await openApp(page);

    await expect(page.getByRole('button', {name: '使用 Google 帳號登入'})).toBeVisible();
    await page.getByRole('button', {name: '訪客遊玩'}).click();

    await expect(page.locator('#view-home')).toHaveClass(/active/);
    await expect(page.locator('#main-nav')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('font-family', /Huninn/);
    await expect(page.locator('.form-group input').first()).toHaveCSS('font-family', /Huninn/);
    await expect(page.getByRole('button', {name: '掃描累積點數'})).toBeVisible();
    await expect(page.getByRole('button', {name: '查看教院生活地圖'})).toBeVisible();
    const [scanButtonBox, mapButtonBox] = await Promise.all([
        page.getByRole('button', {name: '掃描累積點數'}).boundingBox(),
        page.getByRole('button', {name: '查看教院生活地圖'}).boundingBox()
    ]);
    expect(scanButtonBox.height).toBeCloseTo(82, 1);
    expect(mapButtonBox.height).toBeCloseTo(scanButtonBox.height, 1);
    await expect(page.getByRole('button', {name: '查看教院生活地圖'})).toHaveCSS('background-color', 'rgb(92, 118, 109)');
    await expect(page.getByRole('button', {name: '查看教院生活地圖'})).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('首頁依歷史累積點數顯示角色等級', async ({page}) => {
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.evaluate(() => window.renderSparkLevel(18));

    await expect(page.getByRole('heading', {name: '探索火花'})).toBeVisible();
    await expect(page.locator('#spark-level-image')).toHaveAttribute('src', 'assets/levels/lv2-transparent.png');
    await expect(page.locator('#spark-level-progress')).toHaveAttribute('aria-valuenow', '8');
    await expect(page.locator('#spark-level-progress-label')).toHaveText('LV. 2（8/10）');
    await expect(page.locator('#spark-level-kicker')).toHaveCount(0);
    expect(await page.locator('#spark-level-progress').evaluate(element =>
        getComputedStyle(element).getPropertyValue('--spark-progress').trim())).toBe('80%');

    const pointIconBackgrounds = await page.evaluate(() => ({
        home: getComputedStyle(document.querySelector('.home-points-button')).backgroundImage,
        activity: getComputedStyle(document.querySelector('.top-spark-points')).backgroundImage
    }));
    expect(pointIconBackgrounds.home).toBe(pointIconBackgrounds.activity);

    await page.evaluate(() => window.renderSparkLevel(30));
    await expect(page.getByRole('heading', {name: '幻藍大火焰'})).toBeVisible();
    await expect(page.locator('#spark-level-progress-label')).toHaveText('LV. 4（已達最高等級）');
});

test('iPhone 15 Pro 尺寸下首頁縮小並完整顯示吉祥物', async ({page}) => {
    await page.setViewportSize({width: 393, height: 659});
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.evaluate(() => window.renderSparkLevel(18));

    const stage = page.locator('.spark-character-stage');
    const stageBox = await stage.boundingBox();
    const wishButtonBox = await page.locator('.home-wish-button').boundingBox();
    expect(stageBox.width).toBeLessThanOrEqual(270);
    expect(stageBox.height).toBeCloseTo(244, 1);
    expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(wishButtonBox.x);
    await expect(stage).toHaveCSS('border-radius', '26px 26px 26px 8px');
    await expect(stage).toHaveCSS('overflow', 'visible');
    await expect(page.locator('#spark-level-image')).toHaveCSS('object-fit', 'contain');
    await expect(page.locator('#spark-level-image')).toHaveCSS('animation-name', 'sparkFloat');
    const imageBox = await page.locator('#spark-level-image').boundingBox();
    expect(imageBox.width).toBeCloseTo(stageBox.width, 1);
    expect(imageBox.height).toBeCloseTo(stageBox.height, 1);
    await expect(page.locator('#spark-level-image')).toHaveCSS('object-position', '50% 50%');
    await expect(page.locator('.home-title-text h1')).toHaveCSS('font-size', '21px');
    await expect(page.locator('.home-points-button span')).toHaveCSS('font-size', '12px');
    await expect(page.locator('.home-points-button span')).toHaveCSS('margin-top', '10px');
    await expect(page.locator('.home-points-button span')).toHaveCSS('line-height', '12px');
    await expect(page.locator('.home-scan-button')).toHaveCSS('font-size', '24px');
    await expect(page.locator('.home-map-button')).toHaveCSS('font-size', '24px');
});

test('短螢幕桌面版完整顯示角色與首頁按鈕', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 675});
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.evaluate(() => window.renderSparkLevel(20));

    const stage = page.locator('.spark-character-stage');
    const stageBox = await stage.boundingBox();
    const mapButtonBox = await page.locator('.home-map-button').boundingBox();
    const navBox = await page.locator('#main-nav').boundingBox();
    expect(stageBox.height).toBeGreaterThanOrEqual(184);
    expect(stageBox.height).toBeLessThanOrEqual(195);
    await expect(page.locator('#spark-level-image')).toHaveCSS('object-fit', 'contain');
    await expect(page.locator('#spark-level-image')).toHaveAttribute('src', 'assets/levels/lv3-transparent.png');
    expect(mapButtonBox.y + mapButtonBox.height).toBeLessThanOrEqual(navBox.y);
});

test('沒有公告時顯示敬請期待', async ({page}) => {
    await page.route('**/listPublishedAnnouncements', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: []})
        });
    });
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.locator('.nav-item[data-view="view-reward"]').click();

    await expect(page.locator('#view-reward')).toHaveClass(/active/);
    await expect(page.locator('#view-reward .back-btn')).toHaveCount(0);
    await expect(page.locator('#view-reward .announcement-filter-control')).toBeVisible();
    await expect(page.locator('#announcement-filter')).toHaveValue('all');
    await expect(page.getByRole('heading', {name: '公佈欄'})).toBeVisible();
    await expect(page.getByRole('heading', {name: '敬請期待'})).toBeVisible();
    await expect(page.getByRole('img', {name: '小火花'})).toBeVisible();
    await expect(page.locator('.announcement-empty')).toHaveCSS('border-radius', '26px 26px 26px 8px');
});

test('公告保留換行並可依類型篩選', async ({page}) => {
    await page.route('**/listPublishedAnnouncements', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: [{
                id: 'announcement-event',
                title: '活動公告',
                contentHtml: '<div>第一行</div><div>第二行</div><img src="https://example.com/event.png" alt="活動照片" loading="lazy">',
                category: 'event',
                updatedAt: Date.now()
            }, {
                id: 'announcement-update',
                title: '功能公告',
                contentHtml: '<p>新功能內容</p>',
                category: 'update',
                updatedAt: Date.now()
            }]})
        });
    });
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.locator('.nav-item[data-view="view-reward"]').click();

    const headingBox = await page.getByRole('heading', {name: '公佈欄'}).boundingBox();
    expect(headingBox.y).toBeLessThan(90);
    const eventCard = page.locator('.announcement-event');
    await expect(eventCard).toHaveCSS('border-radius', '26px 26px 26px 8px');
    const lines = eventCard.locator('.announcement-rich-content > div');
    await expect(lines).toHaveCount(2);
    const [firstLine, secondLine] = await Promise.all([lines.nth(0).boundingBox(), lines.nth(1).boundingBox()]);
    expect(secondLine.y).toBeGreaterThan(firstLine.y);
    const announcementImage = eventCard.getByRole('img', {name: '活動照片'});
    await expect(announcementImage).toHaveAttribute('loading', 'lazy');
    await expect(announcementImage).toHaveCSS('max-width', '100%');
    await page.locator('#announcement-filter').selectOption('event');
    await expect(page.getByRole('heading', {name: '活動公告'})).toBeVisible();
    await expect(page.getByRole('heading', {name: '功能公告'})).toBeHidden();
});

test('訪客可以看許願池但不能留言', async ({page}) => {
    let liked = false;
    await page.route('**/listWishes', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: [{
                id: 'wish-1',
                message: '希望多一些交流活動',
                authorName: '匿名',
                anonymous: true,
                category: 'suggestion',
                likesCount: 3,
                likedByMe: false,
                adminReply: '謝謝你的建議，我們會安排看看！',
                createdAt: Date.now()
            }]})
        });
    });
    await page.route('**/toggleWishLike', async route => {
        liked = !liked;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: {id: 'wish-1', liked, likesCount: liked ? 4 : 3}})
        });
    });
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.getByRole('button', {name: '許願池'}).click();

    await expect(page.locator('#view-wishes')).toHaveClass(/active/);
    await expect(page.locator('#wish-list')).toContainText('希望多一些交流活動');
    await expect(page.locator('#wish-list')).toContainText('謝謝你的建議，我們會安排看看！');
    await expect(page.locator('.wish-admin-reply')).toContainText('小火花管理員回覆');
    await expect(page.locator('.wish-tag')).toHaveText('建議');
    await expect(page.locator('.wish-like-count')).toHaveText('3');
    await page.getByRole('button', {name: /按讚，目前 3 個讚/}).click();
    await expect(page.locator('.wish-like-count')).toHaveText('4');
    await expect(page.locator('.wish-like-button')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', {name: /取消按讚，目前 4 個讚/}).click();
    await expect(page.locator('.wish-like-count')).toHaveText('3');
    await expect(page.locator('.wish-like-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#wish-filter')).toHaveValue('latest');
    await expect(page.getByText('每一個想法都將成為點亮教院的小火苗！')).toBeVisible();
    await expect(page.locator('.wish-message-card')).toHaveCSS('border-radius', '26px 26px 26px 8px');
    await expect(page.locator('.wish-message-card')).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('#wish-form')).toBeHidden();
    await expect(page.locator('#wish-guest-note')).toBeVisible();
});

test('許願池可依熱門與管理者回覆篩選，類別按鈕會切換顏色', async ({page}) => {
    await page.route('**/listWishes', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: [
                {id: 'latest', message: '最新留言', authorName: '甲', category: 'suggestion', likesCount: 1, createdAt: 300},
                {id: 'popular', message: '熱門留言', authorName: '乙', category: 'curiosity', likesCount: 9, createdAt: 200},
                {id: 'replied', message: '已回覆留言', authorName: '丙', category: 'other', likesCount: 2, createdAt: 100, adminReply: '管理者回覆'}
            ]})
        });
    });
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.getByRole('button', {name: '許願池'}).click();

    await expect(page.locator('.wish-message-card').first()).toContainText('最新留言');
    await page.locator('#wish-filter').selectOption('popular');
    await expect(page.locator('.wish-message-card').first()).toContainText('熱門留言');
    await page.locator('#wish-filter').selectOption('replied');
    await expect(page.locator('.wish-message-card')).toHaveCount(1);
    await expect(page.locator('.wish-message-card')).toContainText('已回覆留言');

    await page.locator('#wish-form').evaluate(form => { form.hidden = false; });
    await page.getByRole('button', {name: '送出留言'}).click();
    await expect(page.locator('#toast')).toHaveText('請選擇本留言的主題類別');
    const curiosityButton = page.getByRole('button', {name: '好奇'});
    await curiosityButton.click();
    await expect(curiosityButton).toHaveAttribute('aria-pressed', 'true');
    await expect(curiosityButton).toHaveCSS('background-color', 'rgb(209, 123, 79)');
    await expect(page.getByRole('button', {name: '建議'})).toHaveAttribute('aria-pressed', 'false');
});

test('點擊排行榜頭像會顯示使用者資訊', async ({page}) => {
    await openApp(page);
    const visibleBio = '甲'.repeat(50);
    const hiddenBio = '這段內容不該顯示';
    const longBio = `${visibleBio}${hiddenBio}`;

    await page.evaluate(bio => {
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.querySelector('#view-social').classList.add('active');
        window.renderLeaderboardUsers([{
            id: 'social-test-user',
            nickname: '測試小火花',
            dept: '教育心理與諮商學系三年級',
            bio,
            points: 18,
            totalPoints: 18
        }]);
    }, longBio);

    await page.getByRole('button', {name: '查看 測試小火花 的個人資訊'}).click();

    const detail = page.locator('#leaderboard-detail');
    await expect(detail).toHaveClass(/active/);
    await expect(detail).toContainText('測試小火花');
    await expect(detail).toContainText('教育心理與諮商學系三年級');
    await expect(detail.locator('.detail-info-block .detail-text')).toHaveText(`自我介紹：${visibleBio}`);
    await expect(detail).not.toContainText(hiddenBio);
    await expect(page.locator('.leaderboard-item')).toHaveCSS('border-radius', '26px 26px 26px 8px');
});

test('積分歷史紀錄依來源顯示標籤', async ({page}) => {
    await openApp(page);
    await page.evaluate(() => {
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.querySelector('#view-point-history').classList.add('active');
        window.renderPointHistory([
            {label: '迎新交流會', type: 'qr', delta: 5, createdAt: Date.now()},
            {label: '協助活動場佈', type: 'admin', delta: 3, createdAt: Date.now()}
        ]);
    });

    const history = page.locator('#point-history-list');
    await expect(history.locator('.point-history-item').first()).toHaveCSS('border-radius', '26px 26px 26px 8px');
    await expect(history.getByText('活動兌換', {exact: true})).toBeVisible();
    await expect(history.getByText('管理員調整', {exact: true})).toBeVisible();
});

test('已兌換活動顯示淺綠色狀態與勾選圖示', async ({page}) => {
    await openApp(page);
    await page.evaluate(() => {
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.querySelector('#view-challenge').classList.add('active');
        window.renderActivities([{
            id: 'redeemed-campaign',
            title: '迎新交流會',
            category: 'in_person',
            description: '測試活動',
            points: 5,
            startsAt: Date.now() - 60_000,
            endsAt: Date.now() + 60_000,
            redeemed: true
        }, {
            id: 'available-campaign',
            title: '尚未參加的活動',
            category: 'interactive',
            description: '測試活動',
            points: 3,
            startsAt: Date.now() - 60_000,
            endsAt: Date.now() + 60_000,
            redeemed: false
        }]);
    });

    const redeemed = page.locator('[data-activity-id="redeemed-campaign"]');
    await expect(redeemed).toHaveCSS('border-radius', '26px 26px 26px 8px');
    await expect(redeemed).toHaveClass(/redeemed/);
    await expect(redeemed.getByLabel('已兌換')).toBeVisible();
    await expect(redeemed).toContainText('已獲得 5 點');
    await expect(redeemed).not.toContainText('完成可獲得');
    const available = page.locator('[data-activity-id="available-campaign"]');
    await expect(available).not.toHaveClass(/redeemed/);
    await expect(available).toContainText('完成可獲得 3 點');
    await page.evaluate(() => window.openActivityCategory('interactive'));
    await expect(redeemed).toHaveCount(0);
    await expect(page.locator('[data-activity-id="available-campaign"]')).toContainText('互動展覽');
    await page.evaluate(() => window.openActivityCategory('limited'));
    await expect(page.locator('#activity-list')).toHaveText('敬請期待！');
    await expect(page.locator('.activity-empty-watermark')).toHaveCSS('filter', /grayscale\(1\)/);
    await expect(page.locator('.activity-empty-watermark')).toHaveCSS('opacity', '0.13');
});

test('教院生活地圖以四個分類入口瀏覽活動', async ({page}) => {
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.getByRole('button', {name: '查看教院生活地圖'}).click();

    const map = page.locator('#activity-map-panel');
    await expect(map.getByRole('heading', {name: '教院生活地圖'})).toBeVisible();
    await expect(map.getByRole('button', {name: '每日打卡'})).toBeVisible();
    await expect(map.getByRole('button', {name: '限定活動'})).toBeVisible();
    await expect(map.getByRole('button', {name: '活動', exact: true})).toBeVisible();
    await expect(map.getByRole('button', {name: '展覽', exact: true})).toBeVisible();

    await map.getByRole('button', {name: '展覽', exact: true}).click();
    await expect(page.locator('#activity-category-panel')).toBeVisible();
    await expect(page.locator('#activity-category-title')).toHaveText('展覽');
    await page.getByRole('button', {name: '返回地圖'}).click();
    await expect(map).toBeVisible();
});

test('活動詳情保留後台輸入的換行與空白', async ({page}) => {
    await openApp(page);
    await page.evaluate(() => window.openActivityDetail({
        title: '排版測試活動',
        category: 'limited',
        description: '第一段\n\n  保留縮排的第二段',
        points: 3,
        startsAt: Date.now() - 60_000,
        endsAt: Date.now() + 60_000
    }));

    const description = page.locator('.activity-detail-description');
    await expect(description).toHaveText('第一段\n\n  保留縮排的第二段');
    await expect(description).toHaveCSS('white-space', 'pre-wrap');
    await expect(page.locator('.activity-detail .activity-category-tag')).toHaveText('限定活動');
});

test('後台 QR code 與公佈欄預設顯示列表並以視窗新增', async ({page}) => {
    await page.route('**/getQrCampaign', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: {
                id: 'campaign-one',
                title: '迎新交流會',
                category: 'interactive',
                description: '活動說明',
                points: 5,
                active: true,
                hasRedemptions: true,
                startsAt: Date.now() - 60_000,
                endsAt: Date.now() + 60_000,
                svg: '<svg></svg>',
                url: 'https://example.com'
            }})
        });
    });
    await page.goto('/admin/index.html');
    await expect(page.locator('#google-admin-login')).toBeVisible();
    await page.evaluate(() => {
        document.querySelector('#admin-login').hidden = true;
        document.querySelector('#admin-dashboard').hidden = false;
        document.querySelector('#admin-qr').hidden = false;
        document.querySelector('#admin-announcements').hidden = false;
    });

    await expect(page.locator('#admin-campaign-list')).toBeVisible();
    await expect(page.getByRole('button', {name: '重新整理'})).toHaveCount(0);
    await page.locator('#open-campaign-form').click();
    const campaignDialog = page.getByRole('dialog', {name: '新增活動 QR code'});
    await expect(campaignDialog).toBeVisible();
    await expect(campaignDialog.locator('#admin-campaign-category option')).toHaveText([
        '請選擇活動類別', '每日打卡', '實體活動', '互動展覽', '限定活動'
    ]);
    await campaignDialog.getByRole('button', {name: '關閉', exact: true}).click();
    await expect(page.locator('#download-qr')).toHaveText('下載 PNG');
    await expect(page.locator('#admin-wish-filter')).toHaveCSS('min-width', '118px');
    await expect(page.locator('#admin-wish-filter')).toHaveCSS('max-width', '150px');

    await page.evaluate(() => window.renderAdminCampaigns([{
        id: 'campaign-one',
        title: '迎新交流會',
        category: 'interactive',
        description: '活動說明',
        points: 5,
        active: true,
        startsAt: Date.now() - 60_000,
        endsAt: Date.now() + 60_000
    }]));
    await page.getByRole('button', {name: '編輯'}).click();
    const editDialog = page.getByRole('dialog', {name: '編輯活動'});
    await expect(editDialog).toBeVisible();
    await expect(editDialog.locator('#admin-campaign-points')).toBeDisabled();
    await expect(editDialog.locator('#admin-campaign-category')).toHaveValue('interactive');
    await expect(editDialog).toContainText('已有使用者兌換，活動點數不能修改。');
    await editDialog.getByRole('button', {name: '關閉', exact: true}).click();

    await expect(page.locator('#admin-announcement-list')).toBeVisible();
    await page.locator('#open-announcement-form').click();
    const announcementDialog = page.getByRole('dialog', {name: '新增公告'});
    await expect(announcementDialog).toBeVisible();
    const promptAnswers = ['https://example.com/announcement.png', '活動照片'];
    page.on('dialog', async dialog => dialog.accept(promptAnswers.shift() || ''));
    await announcementDialog.getByRole('button', {name: '圖片', exact: true}).click();
    const editorImage = announcementDialog.locator('#announcement-content img');
    await expect(editorImage).toHaveAttribute('src', 'https://example.com/announcement.png');
    await expect(editorImage).toHaveAttribute('alt', '活動照片');
    await expect(editorImage).toHaveAttribute('loading', 'lazy');
});

test('後台使用者頁以查詢列表與積分調整視窗呈現', async ({page}) => {
    await page.goto('/admin/index.html');
    await expect(page.locator('#google-admin-login')).toBeVisible();
    await page.evaluate(() => {
        document.querySelector('#admin-login').hidden = true;
        document.querySelector('#admin-dashboard').hidden = false;
        document.querySelector('#admin-users').hidden = false;
        window.renderAdminUsers([{
            uid: 'user-one',
            email: 'student@example.com',
            displayName: '王同學',
            realName: '王同學',
            nickname: '小火花王',
            dept: '教育學系',
            bio: '測試自我介紹',
            points: 12,
            totalPoints: 18,
            isAdmin: false,
            isSuperAdmin: false,
            disabled: false,
            lastSignInAt: Date.now()
        }]);
    });

    await expect(page.locator('#admin-user-query')).toHaveAttribute('placeholder', '輸入 Email、姓名或暱稱');
    await expect(page.locator('.admin-user-row')).toHaveCount(1);
    await page.locator('.admin-user-row-content').hover();
    await expect(page.locator('.admin-user-row-content')).toHaveCSS('transform', 'none');
    await expect(page.locator('.point-user-checkbox')).toBeVisible();
    await expect(page.locator('#open-point-adjustment')).toBeDisabled();
    await expect(page.locator('#batch-points')).toHaveAttribute('min', '-1000');
    await page.locator('.point-user-checkbox').check();
    await page.locator('#open-point-adjustment').click();
    await expect(page.getByRole('dialog', {name: '調整積分'})).toBeVisible();
    await page.getByRole('dialog', {name: '調整積分'}).getByRole('button', {name: '關閉', exact: true}).click();
    await page.locator('.view-user-detail').click();
    const detail = page.getByRole('dialog', {name: '使用者詳細資料'});
    await expect(detail).toContainText('student@example.com');
    await expect(detail.getByRole('button', {name: '設為管理員'})).toBeVisible();
});

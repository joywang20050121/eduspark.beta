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
    await expect(page.locator('body')).toHaveCSS('font-family', /Inter/);
    await expect(page.locator('.form-group input').first()).toHaveCSS('font-family', /Inter/);
    await expect(page.getByRole('button', {name: '掃描累積點數'})).toBeVisible();
    await expect(page.getByRole('button', {name: '查看教院生活地圖'})).toBeVisible();
});

test('首頁依歷史累積點數顯示角色等級', async ({page}) => {
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.evaluate(() => window.renderSparkLevel(18));

    await expect(page.getByRole('heading', {name: '探索火花'})).toBeVisible();
    await expect(page.locator('#spark-level-image')).toHaveAttribute('src', 'assets/levels/lv2.png');
    await expect(page.locator('#spark-level-progress')).toHaveAttribute('aria-valuenow', '8');
    await expect(page.locator('#spark-level-progress-label')).toHaveText('LV. 2（8/10）');

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
    expect(stageBox.width).toBeLessThanOrEqual(294);
    expect(stageBox.height).toBeCloseTo(244, 1);
    await expect(page.locator('#spark-level-image')).toHaveCSS('object-fit', 'contain');
    await expect(page.locator('#spark-level-image')).toHaveCSS('animation-name', 'sparkFloat');
    await expect(page.locator('.home-title-text h1')).toHaveCSS('font-size', '21px');
    await expect(page.locator('.home-points-button span')).toHaveCSS('font-size', '12px');
    await expect(page.locator('.home-scan-button')).toHaveCSS('font-size', '17px');
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
    await expect(page.getByRole('heading', {name: '公佈欄'})).toBeVisible();
    await expect(page.getByRole('heading', {name: '敬請期待'})).toBeVisible();
    await expect(page.getByRole('img', {name: '小火花'})).toBeVisible();
});

test('公告保留換行並可依類型篩選', async ({page}) => {
    await page.route('**/listPublishedAnnouncements', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: [{
                id: 'announcement-event',
                title: '活動公告',
                contentHtml: '<div>第一行</div><div>第二行</div>',
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

    const eventCard = page.locator('.announcement-event');
    const lines = eventCard.locator('.announcement-rich-content > div');
    await expect(lines).toHaveCount(2);
    const [firstLine, secondLine] = await Promise.all([lines.nth(0).boundingBox(), lines.nth(1).boundingBox()]);
    expect(secondLine.y).toBeGreaterThan(firstLine.y);
    await page.locator('#announcement-filter').selectOption('event');
    await expect(page.getByRole('heading', {name: '活動公告'})).toBeVisible();
    await expect(page.getByRole('heading', {name: '功能公告'})).toBeHidden();
});

test('訪客可以看許願池但不能留言', async ({page}) => {
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
                adminReply: '謝謝你的建議，我們會安排看看！',
                createdAt: Date.now()
            }]})
        });
    });
    await openApp(page);
    await page.getByRole('button', {name: '訪客遊玩'}).click();
    await page.getByRole('button', {name: '許願池'}).click();

    await expect(page.locator('#view-wishes')).toHaveClass(/active/);
    await expect(page.locator('#wish-list')).toContainText('希望多一些交流活動');
    await expect(page.locator('#wish-list')).toContainText('謝謝你的建議，我們會安排看看！');
    await expect(page.locator('.wish-admin-reply')).toContainText('小火花管理員回覆');
    await expect(page.locator('.wish-message-card')).toHaveCSS('border-radius', '20px');
    await expect(page.locator('.wish-message-card')).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('#wish-form')).toBeHidden();
    await expect(page.locator('#wish-guest-note')).toBeVisible();
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
            description: '測試活動',
            points: 5,
            startsAt: Date.now() - 60_000,
            endsAt: Date.now() + 60_000,
            redeemed: true
        }, {
            id: 'available-campaign',
            title: '尚未參加的活動',
            description: '測試活動',
            points: 3,
            startsAt: Date.now() - 60_000,
            endsAt: Date.now() + 60_000,
            redeemed: false
        }]);
    });

    const redeemed = page.locator('[data-activity-id="redeemed-campaign"]');
    await expect(redeemed).toHaveClass(/redeemed/);
    await expect(redeemed.getByLabel('已兌換')).toBeVisible();
    await expect(redeemed).toContainText('已獲得 5 點');
    await expect(redeemed).not.toContainText('完成可獲得');
    const available = page.locator('[data-activity-id="available-campaign"]');
    await expect(available).not.toHaveClass(/redeemed/);
    await expect(available).toContainText('完成可獲得 3 點');
});

test('活動詳情保留後台輸入的換行與空白', async ({page}) => {
    await openApp(page);
    await page.evaluate(() => window.openActivityDetail({
        title: '排版測試活動',
        description: '第一段\n\n  保留縮排的第二段',
        points: 3,
        startsAt: Date.now() - 60_000,
        endsAt: Date.now() + 60_000
    }));

    const description = page.locator('.activity-detail-description');
    await expect(description).toHaveText('第一段\n\n  保留縮排的第二段');
    await expect(description).toHaveCSS('white-space', 'pre-wrap');
});

test('後台 QR code 與公佈欄預設顯示列表並以視窗新增', async ({page}) => {
    await page.route('**/getQrCampaign', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({result: {
                id: 'campaign-one',
                title: '迎新交流會',
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
    await campaignDialog.getByRole('button', {name: '關閉', exact: true}).click();
    await expect(page.locator('#download-qr')).toHaveText('下載 PNG');
    await expect(page.locator('#admin-wish-filter')).toHaveCSS('min-width', '118px');
    await expect(page.locator('#admin-wish-filter')).toHaveCSS('max-width', '150px');

    await page.evaluate(() => window.renderAdminCampaigns([{
        id: 'campaign-one',
        title: '迎新交流會',
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
    await expect(editDialog).toContainText('已有使用者兌換，活動點數不能修改。');
    await editDialog.getByRole('button', {name: '關閉', exact: true}).click();

    await expect(page.locator('#admin-announcement-list')).toBeVisible();
    await page.locator('#open-announcement-form').click();
    await expect(page.getByRole('dialog', {name: '新增公告'})).toBeVisible();
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

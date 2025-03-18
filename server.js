
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const paidUsersFile = 'paidUsers.json';

// 📌 ルートエンドポイント (/) を追加（Renderの動作確認用）
app.get("/", (req, res) => {
    res.send("🚀 LINE占いBotが正常に動作しています！");
});

// 📌 有料ユーザー管理（JSONファイルを使用）
function getPaidUsers() {
    if (!fs.existsSync(paidUsersFile)) {
        fs.writeFileSync(paidUsersFile, JSON.stringify({})); // 🚀 初期化
    }
    return JSON.parse(fs.readFileSync(paidUsersFile, 'utf8'));
}

function addPaidUser(userId) {
    const paidUsers = getPaidUsers();
    paidUsers[userId] = true;
    fs.writeFileSync(paidUsersFile, JSON.stringify(paidUsers, null, 2));
}

async function checkSubscription(userId) {
    const paidUsers = getPaidUsers();
    return paidUsers[userId] ? true : false;
}

// 📌 Stripe決済Webhook（ログ出力を追加）
app.post('/stripe-webhook', express.json(), (req, res) => {
    let event = req.body;
    console.log("📩 Stripe Webhook受信:", JSON.stringify(event, null, 2));

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log("🔍 Webhookで受け取ったセッション:", session);

        const userId = session.metadata?.userId;
        if (userId) {
            addPaidUser(userId);
            console.log(`✅ 課金ユーザー登録: ${userId}`);
        } else {
            console.error("❌ Webhookエラー: ユーザーIDが取得できませんでした！");
        }
    }

    res.sendStatus(200);
});

// 📌 Stripe決済リンクを生成
app.get('/create-checkout-session', async (req, res) => {
    try {
        const userId = req.query.userId || "unknown_user";

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [
                {
                    price_data: {
                        currency: 'jpy',
                        product_data: { name: '占いチャットサブスク' },
                        unit_amount: 50000,
                        recurring: { interval: 'month' },
                    },
                    quantity: 1,
                },
            ],
            success_url: `${process.env.BASE_URL}/success`,
            cancel_url: `${process.env.BASE_URL}/cancel`,
            metadata: { userId: userId }
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error("Stripeエラー:", error);
        res.status(500).json({ error: "支払いリンクの作成に失敗しました。" });
    }
});

// 📌 LINEのWebhook（メッセージを受け取る）
app.post('/webhook', async (req, res) => {
    const events = req.body.events;

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            console.log(`ユーザー(${userId})のメッセージ: ${userMessage}`);

            const isPaidUser = await checkSubscription(userId);
            
            if (!isPaidUser) {
                const paymentLink = `${process.env.BASE_URL}/create-checkout-session?userId=${userId}`;
                await replyMessage(userId, `このサービスは月額500円です。\n登録はこちら: ${paymentLink}`);
                continue;
            }

            const replyText = await getChatGPTResponse(userMessage);
            await replyMessage(userId, replyText);
        }
    }

    res.sendStatus(200);
});

// 📌 ChatGPT APIを使って占いのメッセージを取得
async function getChatGPTResponse(userMessage) {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4",
            messages: [
                { role: "system", content: "あなたは優しい占い師です。相談者の悩みに占いの視点から前向きなアドバイスをしてください。" },
                { role: "user", content: userMessage }
            ]
        }, {
            headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("ChatGPT APIエラー:", error);
        return "占いの結果を取得できませんでした…もう一度試してください。";
    }
}

// 📌 LINE APIでユーザーに返信
async function replyMessage(userId, text) {
    await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [{ type: "text", text }]
    }, {
        headers: {
            "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        }
    });
});

// 📌 Stripe決済成功後のページ
app.get('/success', (req, res) => {
    res.send('<h1>決済が完了しました！</h1><p>LINEで「こんにちは」と送って、占いを受けてみてください。</p>');
});

// 📌 Stripe決済キャンセル時のページ
app.get('/cancel', (req, res) => {
    res.send('<h1>決済がキャンセルされました。</h1><p>再度お試しください。</p>');
});

// 📌 サーバー起動（Render対応）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});

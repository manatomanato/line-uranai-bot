require('dotenv').config();
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');

// 環境変数の読み込み確認
console.log("FIREBASE_CREDENTIALS:", process.env.FIREBASE_CREDENTIALS ? "LOADED" : "NOT FOUND");

// Firebase認証情報の設定（Base64環境変数からデコード）
const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_CREDENTIALS, 'base64').toString('utf8')
);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(express.json());

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PAYMENT_LINK = "https://manabuyts.stores.jp/items/12345678";

// 📌 ルートエンドポイント (/) （Render動作確認用）
app.get("/", (req, res) => {
    res.send("🚀 LINE占いBotが正常に動作しています！");
});

// 📌 有料ユーザーをFirestoreからチェック
async function checkSubscription(userId) {
    const userRef = db.collection("paidUsers").doc(userId);
    const doc = await userRef.get();
    return doc.exists && doc.data().isPaid;
}

// 📌 有料ユーザーをFirestoreに登録
async function addPaidUser(userId) {
    await db.collection("paidUsers").doc(userId).set({ isPaid: true });
    console.log(`✅ Firestoreにユーザー登録: ${userId}`);
}

// 📌 決済リンク取得API（LINE以外で使う場合用）
app.post('/get-payment-link', async (req, res) => {
    res.json({ url: PAYMENT_LINK });
});

// 📌 StripeのWebhookエンドポイント（決済成功時に有料ユーザー登録）
app.post('/stripe-webhook', express.json(), async (req, res) => {
    let event;
    try {
        event = req.body;
    } catch (err) {
        console.error("Webhookエラー:", err);
        return res.sendStatus(400);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata?.userId;

        if (userId) {
            await addPaidUser(userId);
        }
    }

    res.sendStatus(200);
});

// 📌 LINEのWebhook（メッセージ処理 & 有料ユーザー確認）
app.post('/webhook', async (req, res) => {
    console.log('Webhook received:', req.body);
    const events = req.body.events;
    if (!events) return res.status(400).send('Invalid request');

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            console.log(`ユーザー(${userId})のメッセージ: ${userMessage}`);
            const isPaidUser = await checkSubscription(userId);

            if (!isPaidUser) {
                await replyMessage(userId, `このサービスは月額500円です。\n登録はこちら: ${PAYMENT_LINK}`);
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
    try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{ type: "text", text }]
        }, {
            headers: {
                "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
    } catch (error) {
        console.error(`LINEメッセージ送信エラー (${userId}):`, error);
    }
}

// 📌 サーバー起動
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
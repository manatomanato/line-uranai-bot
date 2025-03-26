require('dotenv').config();
const express = require('express');
const axios = require('axios');
const admin = require("firebase-admin");

const app = express();
app.use(express.json());

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
    credential: admin.credential.cert(firebaseConfig)
});
const db = admin.firestore();

const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PAYMENT_LINK = "https://manabuyts.stores.jp";

// 📌 ルートエンドポイント
app.get("/", (req, res) => {
    res.send("🚀 LINE占いBotが正常に動作しています！");
});

// 📌 有料ユーザーをチェック
async function checkSubscription(userId) {
    const userRef = db.collection("paidUsers").doc(userId);
    const doc = await userRef.get();
    return doc.exists && doc.data().isPaid;
}

// 📌 有料ユーザーを登録
async function addPaidUser(userId) {
    await db.collection("paidUsers").doc(userId).set({ isPaid: true }, { merge: true });
    console.log(`✅ Firestoreにユーザー登録: ${userId}`);
}

// 📌 ユーザーデータを取得（なければ作成）
async function getUserData(userId) {
    const userRef = db.collection('paidUsers').doc(userId);
    const doc = await userRef.get();

    if (!doc.exists) {
        await userRef.set({
            isPaid: false,
            messageCount: 0,
            joinedAt: admin.firestore.Timestamp.now()
        });
        return { isPaid: false, messageCount: 0 };
    } else {
        return doc.data();
    }
}

// 📌 メッセージカウントを1増やす
async function incrementMessageCount(userId) {
    const userRef = db.collection('paidUsers').doc(userId);
    await userRef.update({
        messageCount: admin.firestore.FieldValue.increment(1)
    });
}

// 📌 Stripe Webhook
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

// 📌 LINE Webhook
app.post('/webhook', async (req, res) => {
    console.log('Webhook received:', req.body);
    const events = req.body.events;
    if (!events) {
        return res.status(400).send('Invalid request');
    }

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            console.log(`ユーザー(${userId})のメッセージ: ${userMessage}`);
            const userData = await getUserData(userId);

            // 無料メッセージ上限チェック
            if (!userData.isPaid && userData.messageCount >= 100) {
                await replyMessage(userId,
                    "💬 期間限定で無料期間中です。友達追加してから1時間から５時間ほどお待ちください。その時間の間に無料で使える設定をするお時間をもらいます。\n" +
                    "期間が過ぎたら続けるには以下をクリックして購入してください。\n" +
                    PAYMENT_LINK
                );
                continue;
            }

            // メッセージカウント+1
            await incrementMessageCount(userId);

            // GPTで返答 → 返信
            const replyText = await getChatGPTResponse(userMessage);
            await replyMessage(userId, replyText);
        }
    }

    res.sendStatus(200);
});

// 📌 ChatGPT APIで占いメッセージ取得
async function getChatGPTResponse(userMessage) {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4",
            messages: [
                { role: "system", content: "あなたは優しい占い師です。相談者の悩みに占いの視点から前向きなアドバイスをしてください。" },
                { role: "user", content: userMessage }
            ]
        }, {
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error("ChatGPT APIエラー:", error);
        return "占いの結果を取得できませんでした…もう一度試してください。";
    }
}

// 📌 LINE APIで返信
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

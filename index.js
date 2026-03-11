require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// --- Глобальные обработчики ошибок ---
process.on('uncaughtException', (err) => {
  console.error('🔥 НЕПЕРЕХВАЧЕННОЕ ИСКЛЮЧЕНИЕ:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 НЕОБРАБОТАННЫЙ ОТКАЗ PROMISE:', reason);
});

// --- Импорт GigaChat ---
let GigaChat;
try {
  GigaChat = require('gigachat').default;
} catch (e) {
  try {
    GigaChat = require('gigachat');
  } catch (e2) {
    console.error('Не удалось загрузить GigaChat. Установите пакет: npm install gigachat');
    process.exit(1);
  }
}
const { Agent } = require('node:https');

// --- Хранилище последней темы ---
const userTopics = new Map();

// --- Диагностика переменных ---
console.log('=== DIAGNOSTICS ===');
console.log('BOT_TOKEN defined:', !!process.env.BOT_TOKEN);
console.log('BOT_TOKEN length:', process.env.BOT_TOKEN ? process.env.BOT_TOKEN.length : 0);
console.log('CHANNEL1_ID defined:', !!process.env.CHANNEL1_ID);
console.log('CHANNEL2_ID defined:', !!process.env.CHANNEL2_ID);
console.log('WEBAPP_URL defined:', !!process.env.WEBAPP_URL);
console.log('SECRET_LINK defined:', !!process.env.SECRET_LINK);
console.log('GIGACHAT_CREDENTIALS defined:', !!process.env.GIGACHAT_CREDENTIALS);
console.log('====================');

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;
const CHANNEL1_ID = process.env.CHANNEL1_ID;
const CHANNEL2_ID = process.env.CHANNEL2_ID;

const bot = new TelegramBot(token);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Вебхук ---
const webhookUrl = `${webAppUrl}/webhook`;
bot.setWebHook(webhookUrl).then(() => {
  console.log(`Webhook установлен на ${webhookUrl}`);
}).catch(err => {
  console.error('Ошибка установки вебхука:', err);
});

app.post('/webhook', (req, res) => {
  console.log('📩 Получен POST запрос на /webhook');
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// --- Функции проверки подписки ---
async function checkSubscription(userId, channelId) {
  if (!channelId) return true;
  try {
    const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${channelId}&user_id=${userId}`;
    const res = await axios.get(url);
    const status = res.data.result.status;
    return ['member', 'administrator', 'creator'].includes(status);
  } catch (e) {
    console.error(`Ошибка проверки подписки для канала ${channelId}:`, e.message);
    return false;
  }
}

async function checkBothSubscriptions(userId) {
  const sub1 = await checkSubscription(userId, CHANNEL1_ID);
  if (!sub1) return false;
  if (CHANNEL2_ID) {
    const sub2 = await checkSubscription(userId, CHANNEL2_ID);
    return sub2;
  }
  return true;
}

// --- Обработка /start ---
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '👋 Привет! Чтобы получить доступ, нажмите кнопку ниже для проверки подписки.', {
    reply_markup: {
      inline_keyboard: [
        [{
          text: '🔎 Проверить подписку',
          web_app: { url: webAppUrl }
        }]
      ]
    }
  });
});

// --- Главное меню ---
async function sendMainMenu(chatId) {
  const menuMessage = `
✨ *Добро пожаловать в «Настройщик души»* ✨

Выберите тему:

🌿 *Безопасность* — тревога, страхи
💗 *Принятие* — одиночество, любовь
🧩 *Понимание себя* — самооценка, внутренний диалог
🌟 *Смысл* — потеря ориентира
🕊️ *Свобода* — ограничения, выбор
  `;

  const keyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '🌿 Безопасность' }],
        [{ text: '💗 Принятие' }],
        [{ text: '🧩 Понимание себя' }],
        [{ text: '🌟 Смысл' }],
        [{ text: '🕊️ Свобода' }]
      ],
      resize_keyboard: true
    }
  };

  await bot.sendMessage(chatId, menuMessage, {
    parse_mode: 'Markdown',
    ...keyboard
  });
}

// --- GigaChat с новым промптом для Свободы ---
async function getGigaChatResponse(userMessage, level) {
  const httpsAgent = new Agent({ rejectUnauthorized: false });

  if (!process.env.GIGACHAT_CREDENTIALS) {
    console.error('GIGACHAT_CREDENTIALS не заданы');
    return 'Извините, нейросеть временно недоступна.';
  }

  const client = new GigaChat({
    credentials: process.env.GIGACHAT_CREDENTIALS,
    scope: 'GIGACHAT_API_PERS',
    model: 'GigaChat',
    httpsAgent: httpsAgent,
    timeout: 60
  });

  const systemPrompt = getSystemPrompt(level);

  try {
    console.log(`[GigaChat] Запрос, тема: ${level}, сообщение: "${userMessage.substring(0,50)}..."`);
    const response = await client.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.8,
      max_tokens: 200
    });
    const answer = response.choices[0]?.message.content || 'Не удалось сгенерировать ответ.';
    console.log(`[GigaChat] Ответ получен, длина: ${answer.length}`);
    return answer;
  } catch (error) {
    console.error('[GigaChat] Ошибка:', error.message, error.stack);
    return 'Извините, сейчас я не могу ответить. Попробуйте позже.';
  }
}

// --- Обновлённые промпты (Свобода изменена) ---
function getSystemPrompt(level) {
  const prompts = {
    'Безопасность': 'Ты — психолог. Тема "Безопасность". Отвечай коротко (1-3 предложения), прямо. Используй технику "признание": помоги заметить и принять чувство. Не анализируй долго.',
    'Принятие': 'Ты — психолог. Тема "Принятие". Отвечай кратко, без нравоучений. Предложи признать чувство одиночества и спросить у него, что оно хочет.',
    'Понимание себя': 'Ты — психолог. Тема "Понимание себя". Помоги услышать разные внутренние голоса. Например: "Какая часть тебя говорит это? А что хочет другая?" Без теорий.',
    'Смысл': 'Ты — психолог. Тема "Смысл". Не давай готовых ответов. Спроси коротко: "Что приносило радость раньше?" Ответь максимум тремя фразами.',
    'Свобода': 'Ты — психолог. Тема "Свобода". Помоги человеку исследовать его ощущение несвободы. Задавай короткие, прямые вопросы: "В чём именно ты чувствуешь себя несвободным?", "Ты заложник ситуации или своих мыслей?", "Если бы можно было сделать всё что угодно, что бы ты выбрал?", "Кто ты в этой истории: жертва, спасатель или тиран?" Не анализируй долго, помогай увидеть ограничения и возможные выходы. Будь мягким, но иногда чуть провокативным.'
  };
  return prompts[level] || prompts['Понимание себя'];
}

// --- Основной обработчик сообщений ---
bot.on('message', async (msg) => {
  console.log('=== ВХОДЯЩЕЕ СООБЩЕНИЕ ===');
  console.log('Chat ID:', msg.chat.id);
  console.log('Текст:', msg.text);

  const chatId = msg.chat.id;
  const text = msg.text;

  if (text.startsWith('/')) {
    console.log('Игнорируем команду');
    return;
  }

  // Проверка подписки на оба канала
  const isSubscribed = await checkBothSubscriptions(chatId);
  if (!isSubscribed) {
    console.log('❌ Пользователь не подписан на все каналы');
    const message = `❌ Вы отписались от одного из каналов.\n\nПожалуйста, подпишитесь снова, чтобы продолжить:\n1. ${CHANNEL1_ID}\n2. ${CHANNEL2_ID || 'не задан'}\n\nПосле подписки начните диалог заново.`;
    await bot.sendMessage(chatId, message);
    return;
  }

  const levelMap = {
    '🌿 Безопасность': 'Безопасность',
    '💗 Принятие': 'Принятие',
    '🧩 Понимание себя': 'Понимание себя',
    '🌟 Смысл': 'Смысл',
    '🕊️ Свобода': 'Свобода'
  };

  if (levelMap[text]) {
    const level = levelMap[text];
    userTopics.set(chatId, level);
    console.log(`✅ Установлена тема: ${level}`);

    await bot.sendChatAction(chatId, 'typing');
    const initialPrompt = `Я выбрал тему "${level}". Поговори со мной об этом.`;
    const response = await getGigaChatResponse(initialPrompt, level);
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    return;
  }

  const currentLevel = userTopics.get(chatId);
  if (!currentLevel) {
    console.log('⛔ Нет активной темы');
    return;
  }

  console.log(`➡️ Есть тема: ${currentLevel}, отправляем в GigaChat`);
  await bot.sendChatAction(chatId, 'typing');
  const response = await getGigaChatResponse(text, currentLevel);
  await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});

// --- Эндпоинт для веб-приложения ---
app.post('/api/check-sub', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  try {
    const isMember = await checkSubscription(userId, CHANNEL1_ID);
    if (isMember) await sendMainMenu(userId);
    res.json({ ok: true, isMember });
  } catch (e) {
    console.error(`Ошибка проверки подписки для userId=${userId}:`, e.message);
    res.status(500).json({ ok: false, error: 'Ошибка проверки на стороне сервера.' });
  }
});

// --- Запуск сервера ---
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`✅ Webhook URL: ${webAppUrl}/webhook`);
});

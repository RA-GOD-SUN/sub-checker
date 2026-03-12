require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const redis = require('redis');

// --- Глобальные обработчики ошибок ---
process.on('uncaughtException', (err) => {
  console.error('🔥 НЕПЕРЕХВАЧЕННОЕ ИСКЛЮЧЕНИЕ:', err);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 НЕОБРАБОТАННЫЙ ОТКАЗ PROMISE:', reason);
  if (reason && reason.stack) console.error(reason.stack);
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

// --- Подключение к Redis ---
const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect().then(() => console.log('✅ Redis подключён'));

// --- Чтение переменных окружения ---
const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;

// Канал 1 (обязательный)
const CHANNEL1_ID = process.env.CHANNEL1_ID;
const CHANNEL1_NAME = process.env.CHANNEL1_NAME || 'Основной канал';
const CHANNEL1_LINK = process.env.CHANNEL1_LINK;
const CHANNEL1_SHOW = process.env.CHANNEL1_SHOW !== 'false';

// Канал 2
const CHANNEL2_ID = process.env.CHANNEL2_ID;
const CHANNEL2_NAME = process.env.CHANNEL2_NAME || 'Дополнительный канал';
const CHANNEL2_LINK = process.env.CHANNEL2_LINK;
const CHANNEL2_SHOW = process.env.CHANNEL2_SHOW === 'true';
const CHANNEL2_REQUIRED = process.env.CHANNEL2_REQUIRED === 'true';

// --- Диагностика ---
console.log('=== DIAGNOSTICS ===');
console.log('BOT_TOKEN defined:', !!token);
console.log('BOT_TOKEN length:', token ? token.length : 0);
console.log('CHANNEL1_ID:', CHANNEL1_ID);
console.log('CHANNEL1_NAME:', CHANNEL1_NAME);
console.log('CHANNEL1_LINK:', CHANNEL1_LINK);
console.log('CHANNEL1_SHOW:', CHANNEL1_SHOW);
console.log('CHANNEL2_ID:', CHANNEL2_ID);
console.log('CHANNEL2_NAME:', CHANNEL2_NAME);
console.log('CHANNEL2_LINK:', CHANNEL2_LINK);
console.log('CHANNEL2_SHOW:', CHANNEL2_SHOW);
console.log('CHANNEL2_REQUIRED:', CHANNEL2_REQUIRED);
console.log('WEBAPP_URL defined:', !!webAppUrl);
console.log('GIGACHAT_CREDENTIALS defined:', !!process.env.GIGACHAT_CREDENTIALS);
console.log('REDIS_URL defined:', !!process.env.REDIS_URL);
console.log('====================');

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

// ============================================================================
// ФУНКЦИИ ПРОВЕРКИ ПОДПИСКИ
// ============================================================================

async function checkSubscription(userId, channelId, channelName) {
  if (!channelId) {
    console.log(`⚠️ ${channelName} не задан, пропускаем проверку`);
    return { isMember: true, error: false };
  }
  try {
    const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${channelId}&user_id=${userId}`;
    console.log(`🔍 Проверка подписки на ${channelName} (${channelId}) для userId ${userId}`);
    const res = await axios.get(url);
    const status = res.data.result.status;
    const isMember = ['member', 'administrator', 'creator'].includes(status);
    console.log(`📊 Результат проверки ${channelName}: статус ${status}, подписан: ${isMember}`);
    return { isMember, error: false };
  } catch (e) {
    console.error(`❌ Ошибка проверки подписки для канала ${channelName} (${channelId}):`, e.message);
    if (e.response) console.error('Детали ошибки:', e.response.data);
    return { isMember: false, error: true };
  }
}

async function getSubscriptionStatus(userId) {
  const statuses = [];

  if (CHANNEL1_ID) {
    const sub1 = await checkSubscription(userId, CHANNEL1_ID, CHANNEL1_NAME);
    statuses.push({
      id: CHANNEL1_ID,
      name: CHANNEL1_NAME,
      link: CHANNEL1_LINK,
      isMember: sub1.isMember,
      error: sub1.error,
      required: true,
      show: CHANNEL1_SHOW
    });
  }

  if (CHANNEL2_ID) {
    const sub2 = await checkSubscription(userId, CHANNEL2_ID, CHANNEL2_NAME);
    statuses.push({
      id: CHANNEL2_ID,
      name: CHANNEL2_NAME,
      link: CHANNEL2_LINK,
      isMember: sub2.isMember,
      error: sub2.error,
      required: CHANNEL2_REQUIRED,
      show: CHANNEL2_SHOW
    });
  }

  console.log('📋 Полный статус подписки:', JSON.stringify(statuses, null, 2));
  return statuses;
}

function isFullySubscribed(statuses) {
  return statuses.every(ch => !ch.required || ch.isMember);
}

function formatUnsubscribedMessage(statuses) {
  const missing = statuses.filter(ch => ch.show && !ch.isMember);
  if (missing.length === 0) return null;

  let text = '❌ Для доступа необходимо подписаться на каналы:\n\n';
  const buttons = [];

  for (const ch of missing) {
    text += `• ${ch.name}\n`;
    if (ch.link) {
      buttons.push([{ text: `📢 Подписаться на ${ch.name}`, url: ch.link }]);
    } else {
      text += `  (ссылка не указана, обратитесь к администратору)\n`;
    }
  }

  text += '\nПосле подписки нажмите /start или отправьте любое сообщение, чтобы проверить снова.';
  return { text, buttons };
}

// ============================================================================
// ФУНКЦИИ ДЛЯ РАБОТЫ С ИСТОРИЕЙ В REDIS
// ============================================================================

const HISTORY_KEY_PREFIX = 'history:';
const MAX_HISTORY = 10; // храним последние 10 сообщений

async function addMessageToHistory(chatId, role, content) {
  const key = HISTORY_KEY_PREFIX + chatId;
  let history = await redisClient.get(key);
  history = history ? JSON.parse(history) : [];
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.shift(); // удаляем самое старое
  await redisClient.set(key, JSON.stringify(history));
  console.log(`📝 История для ${chatId} обновлена, теперь ${history.length} сообщений`);
}

async function getHistory(chatId) {
  const key = HISTORY_KEY_PREFIX + chatId;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : [];
}

// ============================================================================
// ОБРАБОТЧИКИ КОМАНД
// ============================================================================

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

bot.onText(/\/privacy|\/policy/, (msg) => {
  const chatId = msg.chat.id;
  const policyText = `
*ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ БОТА «Настройщик души»*  

1. *Какие данные собираются*  
   • Ваш Telegram ID — для проверки подписки на каналы и идентификации.  
   • Текстовые сообщения, которые вы отправляете боту — для генерации ответов через ИИ.  
   • Информация о подписке на каналы Nastroyshik_Dushi и Psy_Chat (только факт подписки).

2. *Как используются данные*  
   • Telegram ID и статус подписки — для предоставления доступа к функционалу.  
   • Сообщения — для обработки нейросетью GigaChat (Сбер) и формирования ответов.

3. *Передача третьим лицам*  
   • Сообщения передаются в GigaChat для обработки.  
   • Никакие данные не продаются и не передаются другим лицам.

4. *Хранение данных*  
   • История переписки не сохраняется на сервере после отправки ответа.  
   • Ваш ID хранится только для проверки подписки (в оперативной памяти).

5. *Ваши права*  
   • Вы можете в любой момент прекратить использование бота.  
   • Для удаления данных напишите администратору: @Nastroyschik_dushi (с пометкой «Удалить мои данные»).

6. *Контакты*  
   • По вопросам конфиденциальности: @Nastroyschik_dushi

Последнее обновление: 12 марта 2026 г.
  `;
  bot.sendMessage(chatId, policyText, { parse_mode: 'Markdown' });
});

// ============================================================================
// ГЛАВНОЕ МЕНЮ (опционально)
// ============================================================================

async function sendMainMenu(chatId) {
  const menuMessage = `
✨ *Добро пожаловать в «Настройщик души»* ✨

Выберите тему, с которой хотите поработать (или просто напишите свой вопрос):

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

// ============================================================================
// УЛУЧШЕННАЯ ФУНКЦИЯ ДЛЯ GIGACHAT (с повторными попытками и историей)
// ============================================================================

async function getGigaChatResponse(userMessage, history, level = null) {
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
    timeout: 120, // увеличенный таймаут
  });

  // Формируем системный промпт в зависимости от того, выбрана ли тема
  let systemPrompt;
  if (level && levelMap[level]) {
    // Если тема выбрана из меню, используем специализированный промпт
    systemPrompt = getThemePrompt(level);
  } else {
    // Универсальный промпт для свободного диалога
    systemPrompt = `Ты — психолог, работающий в кратком, вопросном стиле (вдохновлён подходом Тальписа). Твоя задача — помочь человеку исследовать его чувства, задавая открытые вопросы. Используй техники:

- Признание: помоги заметить и принять чувство («Просто признай эту тревогу и дай ей место»).
- Работа с частями: спроси, какая часть говорит это, а что хочет другая.
- Метафоры: если уместно, предложи простую метафору.
- Упражнения: в конце ответа предложи короткое действие (например, «подыши и спроси эту часть, чего она на самом деле хочет»).

Не давай готовых советов, не оценивай, не читай мораль. Задавай вопросы, которые помогут человеку самому прийти к пониманию. После ответа человека задавай следующий уточняющий вопрос, сохраняя связь с предыдущим. Отвечай коротко (1-3 предложения).`;
  }

  // Собираем сообщения для GigaChat: системный промпт + история + текущее сообщение
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  // Повторные попытки при ошибках
  const maxRetries = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[GigaChat] Попытка ${attempt}, сообщение: "${userMessage.substring(0,50)}..."`);
      const response = await client.chat({
        messages: messages,
        temperature: 0.8,
        max_tokens: 250
      });
      const answer = response.choices[0]?.message.content || 'Не удалось сгенерировать ответ.';
      console.log(`[GigaChat] Ответ получен, длина: ${answer.length}`);
      return answer;
    } catch (error) {
      lastError = error;
      console.error(`[GigaChat] Ошибка (попытка ${attempt}):`, error.message);
      if (attempt < maxRetries) {
        // Экспоненциальная задержка
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  console.error('[GigaChat] Все попытки исчерпаны:', lastError);
  return '🚧 Извините, нейросеть временно не отвечает. Попробуйте чуть позже.';
}

// Промпты для конкретных тем (можно оставить как есть или улучшить)
function getThemePrompt(level) {
  const prompts = {
    'Безопасность': `Ты — психолог, тема "Безопасность" (тревога, страх). Используй техники: признание, работа с частями, метафоры. Задавай открытые вопросы, не давай советов.`,
    'Принятие': `Ты — психолог, тема "Принятие" (одиночество, любовь). Помоги человеку исследовать его чувства, задавая вопросы. Используй признание и работу с частями.`,
    'Понимание себя': `Ты — психолог, тема "Понимание себя" (самооценка, внутренний диалог). Помоги услышать разные части себя, задавай уточняющие вопросы.`,
    'Смысл': `Ты — психолог, тема "Смысл" (потеря ориентира). Помоги искать смысл внутри себя через вопросы, не давай готовых ответов.`,
    'Свобода': `Ты — психолог, тема "Свобода" (ограничения). Исследуй, что именно ограничивает человека, задавай открытые вопросы.`
  };
  return prompts[level] || prompts['Понимание себя'];
}

// Для сопоставления кнопок с темами
const levelMap = {
  '🌿 Безопасность': 'Безопасность',
  '💗 Принятие': 'Принятие',
  '🧩 Понимание себя': 'Понимание себя',
  '🌟 Смысл': 'Смысл',
  '🕊️ Свобода': 'Свобода'
};

// ============================================================================
// ОСНОВНОЙ ОБРАБОТЧИК СООБЩЕНИЙ (с историей и свободным диалогом)
// ============================================================================

bot.on('message', async (msg) => {
  console.log('=== ВХОДЯЩЕЕ СООБЩЕНИЕ ===');
  console.log('Chat ID:', msg.chat.id);
  console.log('Текст:', msg.text);

  const chatId = msg.chat.id;
  const text = msg.text;

  // Игнорируем служебные сообщения от групп/каналов
  if (chatId < 0) {
    console.log('⚠️ Сообщение из группы/канала, игнорируем');
    return;
  }

  if (text.startsWith('/')) {
    console.log('Игнорируем команду (она обработана выше)');
    return;
  }

  // --- 1. Проверка подписки ---
  console.log('🔐 Получаем статус подписки...');
  const statuses = await getSubscriptionStatus(chatId);
  const fullySubscribed = isFullySubscribed(statuses);
  console.log(`🔐 Полностью подписан на обязательные: ${fullySubscribed}`);

  const unsubInfo = formatUnsubscribedMessage(statuses);
  if (unsubInfo) {
    console.log('❌ Пользователь не подписан на некоторые каналы (показываем)');
    await bot.sendMessage(chatId, unsubInfo.text, {
      reply_markup: { inline_keyboard: unsubInfo.buttons }
    });
    if (!fullySubscribed) return;
  }

  // --- 2. Получаем историю из Redis ---
  const history = await getHistory(chatId);
  console.log(`📖 История для ${chatId}: ${history.length} сообщений`);

  // --- 3. Определяем, является ли сообщение выбором темы из меню ---
  const selectedLevel = levelMap[text];
  if (selectedLevel) {
    // Сохраняем в историю сообщение пользователя
    await addMessageToHistory(chatId, 'user', text);
    console.log(`✅ Пользователь выбрал тему: ${selectedLevel}`);

    await bot.sendChatAction(chatId, 'typing');
    // Передаём в GigaChat с указанием темы
    const response = await getGigaChatResponse(text, history, selectedLevel);
    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    // Сохраняем ответ в историю
    await addMessageToHistory(chatId, 'assistant', response);
    return;
  }

  // --- 4. Свободный диалог (не тема из меню) ---
  // Сохраняем сообщение пользователя в историю
  await addMessageToHistory(chatId, 'user', text);

  await bot.sendChatAction(chatId, 'typing');
  const response = await getGigaChatResponse(text, history, null); // без темы
  await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });

  // Сохраняем ответ в историю
  await addMessageToHistory(chatId, 'assistant', response);
});

// ============================================================================
// ЭНДПОИНТ ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ (проверка подписки и выдача меню)
// ============================================================================

app.post('/api/check-sub', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  try {
    const sub1 = await checkSubscription(userId, CHANNEL1_ID, CHANNEL1_NAME);
    if (sub1.isMember) {
      await sendMainMenu(userId);
    }
    res.json({ ok: true, isMember: sub1.isMember });
  } catch (e) {
    console.error(`Ошибка проверки подписки для userId=${userId}:`, e.message);
    res.status(500).json({ ok: false, error: 'Ошибка проверки на стороне сервера.' });
  }
});

// ============================================================================
// ЗАПУСК СЕРВЕРА
// ============================================================================

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`✅ Webhook URL: ${webAppUrl}/webhook`);
});

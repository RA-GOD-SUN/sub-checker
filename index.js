require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const path = require('path');

console.log('=== MINIMAL DIAGNOSTICS ===');
console.log('BOT_TOKEN defined:', !!process.env.BOT_TOKEN);
console.log('WEBAPP_URL defined:', !!process.env.WEBAPP_URL);
console.log('===========================');

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL;
const bot = new TelegramBot(token);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const webhookUrl = `${webAppUrl}/webhook`;
bot.setWebHook(webhookUrl).then(() => {
  console.log(`Webhook установлен на ${webhookUrl}`);
}).catch(err => {
  console.error('Ошибка установки вебхука:', err);
});

app.post('/webhook', (req, res) => {
  console.log('Получен POST запрос на /webhook');
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
  console.log(`Команда /start от ${msg.chat.id}`);
  bot.sendMessage(msg.chat.id, '👋 Привет! Я эхо-бот. Напиши что-нибудь.');
});

bot.on('message', (msg) => {
  console.log(`Получено сообщение от ${msg.chat.id}: "${msg.text}"`);
  bot.sendMessage(msg.chat.id, `Вы написали: "${msg.text}"`);
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Webhook URL: ${webAppUrl}/webhook`);
});

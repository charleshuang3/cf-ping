import { Env } from './types';

export async function sendTelegramMessage(env: Env, message: string): Promise<Response> {
  const telegramApiUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown', // Optional: for formatting like bold, italic
  };

  try {
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Telegram API error: ${response.status} ${response.statusText}`, errorData);
      return new Response(`Telegram API error: ${errorData}`, { status: response.status });
    }
    return response;
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return new Response(`Failed to send Telegram message: ${error}`, { status: 500 });
  }
}

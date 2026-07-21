const CLIENT_ID = process.env.DHAN_CLIENT_ID;
const ACCESS_TOKEN = process.env.DHAN_ACCESS_TOKEN;

async function testQuote() {
  console.log('Fetching Live Market Quote for Active NIFTY July 2026 Options (SecID 35022 & 35023)...');
  try {
    const res = await fetch('https://api.dhan.co/v2/marketfeed/quote', {
      method: 'POST',
      headers: {
        'access-token': ACCESS_TOKEN,
        'client-id': CLIENT_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        NSE_FNO: [35022, 35023],
      }),
    });
    const data = await res.json();
    console.log('Status:', res.status, res.statusText);
    console.log('Live Option Quotes Data:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Quote Error:', e);
  }
}

testQuote();

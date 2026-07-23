async function testAppHealth() {
  console.log('Testing App Health at http://localhost:3005...');
  try {
    const res = await fetch('http://localhost:3005/api/auto-trade');
    const text = await res.text();
    console.log('API Status Code:', res.status);
    console.log('API Output Preview:', text.slice(0, 150));
  } catch (err) {
    console.error('App check failed:', err);
  }
}

testAppHealth();

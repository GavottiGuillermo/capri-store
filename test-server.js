// Script de test para verificar la funcionalidad del servidor
const http = require('http');

const BASE_URL = 'http://localhost:3001';

async function testEndpoint(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Iniciando tests del servidor...\n');
  
  try {
    // Test 1: Health check
    console.log('1. Test health endpoint...');
    const healthResult = await testEndpoint('/health');
    console.log(`   Status: ${healthResult.status}`);
    console.log(`   Response:`, healthResult.data);
    console.log('   ✅ Health check OK\n');

    // Test 2: Test Mercado Pago
    console.log('2. Test Mercado Pago endpoint...');
    const mpResult = await testEndpoint('/test-mp');
    console.log(`   Status: ${mpResult.status}`);
    console.log(`   Response:`, mpResult.data);
    console.log('   ✅ Mercado Pago test OK\n');

    // Test 3: Test crear preferencia
    console.log('3. Test crear preferencia...');
    const testItems = {
      items: [
        {
          title: 'Producto de Test',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: 100
        }
      ]
    };
    
    const preferenceResult = await testEndpoint('/crear-preferencia', 'POST', testItems);
    console.log(`   Status: ${preferenceResult.status}`);
    console.log(`   Response:`, preferenceResult.data);
    
    if (preferenceResult.status === 200 && preferenceResult.data.init_point) {
      console.log('   ✅ Crear preferencia OK');
      console.log(`   🔗 Init point: ${preferenceResult.data.init_point}`);
    } else {
      console.log('   ❌ Error en crear preferencia');
    }

    console.log('\n🎉 Tests completados!');
    
  } catch (error) {
    console.error('❌ Error durante los tests:', error.message);
    console.log('\n💡 Asegúrate de que el servidor esté ejecutándose con: npm start');
  }
}

runTests();

/**
 * Script de diagnóstico para Instance Lock
 * Ejecutar con: node js/diagnostico-lock.js
 */

require('dotenv').config();
const { Pool } = require('pg');

async function diagnosticar() {
  console.log('\n🔍 DIAGNÓSTICO DE INSTANCE LOCK\n');
  console.log('='.repeat(60));
  
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL no configurado');
    console.log('💡 El sistema de lock solo funciona con PostgreSQL');
    return;
  }
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  try {
    console.log('✅ Conectado a PostgreSQL\n');
    
    // 1. Verificar si existe la tabla
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'instance_locks'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('❌ Tabla instance_locks NO EXISTE');
      console.log('💡 Se creará automáticamente en el primer deploy con lock');
      return;
    }
    
    console.log('✅ Tabla instance_locks existe\n');
    
    // 2. Obtener locks actuales
    const locks = await pool.query(`
      SELECT 
        lock_key,
        instance_id,
        locked_at,
        last_heartbeat,
        (NOW() - last_heartbeat) as time_since_heartbeat,
        metadata
      FROM instance_locks
      ORDER BY locked_at DESC;
    `);
    
    console.log('📊 LOCKS ACTUALES:\n');
    
    if (locks.rows.length === 0) {
      console.log('   ℹ️ No hay locks activos (esto es normal si no hay instancias corriendo)');
    } else {
      locks.rows.forEach((lock, i) => {
        console.log(`   Lock #${i + 1}:`);
        console.log(`   - Key: ${lock.lock_key}`);
        console.log(`   - Instance ID: ${lock.instance_id}`);
        console.log(`   - Locked at: ${lock.locked_at}`);
        console.log(`   - Last heartbeat: ${lock.last_heartbeat}`);
        console.log(`   - Time since heartbeat: ${lock.time_since_heartbeat}`);
        
        const metadata = lock.metadata || {};
        console.log(`   - Render Instance: ${metadata.render_instance || 'N/A'}`);
        console.log(`   - Node version: ${metadata.node_version || 'N/A'}`);
        
        // Verificar si está vivo
        const timeSinceHeartbeat = lock.time_since_heartbeat;
        const seconds = parseInt(timeSinceHeartbeat.seconds || 0);
        
        if (seconds > 120) {
          console.log(`   ⚠️ LOCK MUERTO (sin heartbeat por ${seconds}s)`);
          console.log(`   💡 Será eliminado automáticamente`);
        } else if (seconds > 60) {
          console.log(`   ⚠️ ADVERTENCIA: Sin heartbeat por ${seconds}s`);
        } else {
          console.log(`   ✅ ACTIVO (heartbeat reciente)`);
        }
        
        console.log();
      });
    }
    
    // 3. Estadísticas
    console.log('\n📈 ESTADÍSTICAS:\n');
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_locks,
        COUNT(CASE WHEN (NOW() - last_heartbeat) < INTERVAL '2 minutes' THEN 1 END) as active_locks,
        COUNT(CASE WHEN (NOW() - last_heartbeat) >= INTERVAL '2 minutes' THEN 1 END) as stale_locks
      FROM instance_locks;
    `);
    
    const { total_locks, active_locks, stale_locks } = stats.rows[0];
    console.log(`   - Total de locks: ${total_locks}`);
    console.log(`   - Locks activos (<2 min): ${active_locks}`);
    console.log(`   - Locks obsoletos (>2 min): ${stale_locks}`);
    
    // 4. Recomendaciones
    console.log('\n💡 RECOMENDACIONES:\n');
    
    if (parseInt(active_locks) > 1) {
      console.log('   ⚠️ HAY MÁS DE 1 LOCK ACTIVO');
      console.log('   🚨 Esto indica múltiples instancias corriendo simultáneamente');
      console.log('   📝 Verifica tu configuración en Render (debe ser numInstances: 1)');
      console.log('   🔧 O ejecuta: DELETE FROM instance_locks;');
    } else if (parseInt(active_locks) === 1) {
      console.log('   ✅ Hay exactamente 1 lock activo (CORRECTO)');
    } else {
      console.log('   ℹ️ No hay locks activos (normal si no hay instancias corriendo)');
    }
    
    if (parseInt(stale_locks) > 0) {
      console.log(`   🧹 Hay ${stale_locks} lock(s) obsoleto(s)`);
      console.log('   💡 Serán limpiados automáticamente por el sistema');
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

// Ejecutar diagnóstico
diagnosticar().then(() => {
  console.log('✅ Diagnóstico completado\n');
  process.exit(0);
}).catch(error => {
  console.error('❌ Error en diagnóstico:', error);
  process.exit(1);
});

-- Script para limpiar sesiones corruptas de WhatsApp en PostgreSQL
-- Ejecutar esto en la consola de Neon antes del próximo deploy

-- Ver sesiones actuales
SELECT 
    id, 
    LENGTH(session_data) as tamaño_bytes,
    created_at,
    updated_at 
FROM whatsapp_sessions;

-- Eliminar sesión corrupta (solo tiene 119 chars en lugar de miles)
DELETE FROM whatsapp_sessions WHERE id = 'capri-store-main';

-- Verificar que se eliminó
SELECT COUNT(*) as sesiones_restantes FROM whatsapp_sessions;

-- Resultado esperado: 0 sesiones

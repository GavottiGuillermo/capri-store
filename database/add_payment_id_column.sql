-- Agregar columna para guardar el Payment ID de MercadoPago
-- Esto nos permitirá correlacionar el pago con el pedido generado

ALTER TABLE productos 
ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;

-- Agregar comentario para documentar la columna
COMMENT ON COLUMN productos.mp_payment_id IS 'Payment ID de MercadoPago para correlacionar con el pedido generado';

-- Verificar que la columna se agregó correctamente
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'productos' 
AND column_name = 'mp_payment_id';
-- Script para agregar columna payment_id a la tabla productos
-- Esta columna guardará el payment ID de MercadoPago para correlacionar con id_pedido

-- Agregar la nueva columna
ALTER TABLE productos 
ADD COLUMN IF NOT EXISTS payment_id TEXT;

-- Crear índice para mejorar performance de búsquedas
CREATE INDEX IF NOT EXISTS idx_productos_payment_id ON productos (payment_id);

-- Comentarios sobre la nueva columna:
-- - payment_id: Guardará el ID del pago de MercadoPago (ej: "122156582223")
-- - Esto permitirá correlacionar el payment ID con el id_pedido generado (P0001, P0002, etc.)
-- - El teléfono se guardará correctamente en pedido_telefono_cliente

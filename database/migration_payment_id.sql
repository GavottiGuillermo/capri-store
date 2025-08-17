-- Script de migración completa para corregir el sistema de pedidos
-- Ejecutar en orden en la base de datos

-- PASO 1: Agregar la nueva columna payment_id
ALTER TABLE productos 
ADD COLUMN IF NOT EXISTS payment_id TEXT;

-- PASO 2: Crear índice para mejorar performance
CREATE INDEX IF NOT EXISTS idx_productos_payment_id ON productos (payment_id);

-- PASO 3: Actualizar el stored procedure
-- DROP PROCEDURE IF EXISTS public.sp_crear_pedido_web(text, double precision, text, text, text, text, text);

CREATE OR REPLACE PROCEDURE public.sp_crear_pedido_web(
	IN in_id_productos text,
	IN in_monto_total double precision,
	IN in_nombre_cliente text,
	IN in_correo_cliente text,
	IN in_telefono_cliente text,
	IN in_metodo_pago text, -- Ahora recibirá "MercadoPago 122156582223"
	IN in_tipo_entrega text)
LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
  id_pago_sp BIGINT;
  id_pedido_sp TEXT;
  ultimo_pedido_sp TEXT;
  nuevo_numero_pedido_sp INT;
  estado_pedido_sp TEXT;
  payment_id_mp TEXT;
BEGIN
  IF in_tipo_entrega NOT IN ('Retiro','Envio') THEN
    RAISE EXCEPTION 'Tipo de entrega inválido: %', in_tipo_entrega;
  END IF;

  -- Extraer el payment ID de MercadoPago del string "MercadoPago 122156582223"
  payment_id_mp := TRIM(SUBSTRING(in_metodo_pago FROM 'MercadoPago (.+)'));
  IF payment_id_mp IS NULL OR payment_id_mp = '' THEN
    payment_id_mp := in_metodo_pago; -- Fallback al valor completo
  END IF;

  INSERT INTO clientes (nombre_cliente, correo_cliente)
  VALUES (in_nombre_cliente, in_correo_cliente)
  ON CONFLICT DO NOTHING;

  -- Guardar el payment ID de MercadoPago en metodo_pago
  INSERT INTO pagos (fecha_pago, monto, nombre_cliente, metodo_pago)
  VALUES (CURRENT_DATE, in_monto_total, in_nombre_cliente, in_metodo_pago)
  RETURNING id_pago INTO id_pago_sp;

  SELECT p.id_pedido
  INTO ultimo_pedido_sp
  FROM productos p
  WHERE p.id_pedido IS NOT NULL
  ORDER BY CAST(SUBSTRING(p.id_pedido FROM 2) AS INT) DESC
  LIMIT 1;

  IF ultimo_pedido_sp IS NULL THEN
    nuevo_numero_pedido_sp := 1;
  ELSE
    nuevo_numero_pedido_sp := CAST(SUBSTRING(ultimo_pedido_sp FROM 2) AS INT) + 1;
  END IF;

  id_pedido_sp := 'P' || LPAD(nuevo_numero_pedido_sp::TEXT, 4, '0');

  estado_pedido_sp := CASE
    WHEN in_tipo_entrega = 'Retiro' THEN 'Pendiente Retiro'
    ELSE 'Pendiente Envio'
  END;

  -- ACTUALIZACIÓN CORREGIDA: 
  -- - Teléfono va a pedido_telefono_cliente (dato obligatorio)
  -- - Payment ID va a la nueva columna payment_id
  UPDATE productos
  SET id_pedido = id_pedido_sp,
      id_pago = id_pago_sp,
      estado = estado_pedido_sp,
      pedido_fecha = CURRENT_TIMESTAMP,
      pedido_nombre_cliente = in_nombre_cliente,
      pedido_correo_cliente = in_correo_cliente,
      pedido_telefono_cliente = in_telefono_cliente, -- Teléfono real del cliente
      pedido_monto_total = in_monto_total,
      pedido_tipo_entrega = in_tipo_entrega,
      payment_id = payment_id_mp -- Nueva columna para payment ID
  WHERE id_articulo = ANY(string_to_array(in_id_productos, ',')::INT[]);

  -- Log para debugging
  RAISE NOTICE 'Pedido creado: id_pedido=%, payment_id=%, telefono=%, productos_actualizados=%', 
    id_pedido_sp, payment_id_mp, in_telefono_cliente, array_length(string_to_array(in_id_productos, ','), 1);
  
END;
$BODY$;

ALTER PROCEDURE public.sp_crear_pedido_web(text, double precision, text, text, text, text, text)
    OWNER TO neondb_owner;

-- PASO 4: Confirmar que la migración funcionó
-- Verificar que la columna existe
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'productos' AND column_name = 'payment_id';

-- Verificar que el índice existe
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'productos' AND indexname = 'idx_productos_payment_id';

-- COMENTARIOS FINALES:
-- 1. La columna payment_id permitirá correlacionar perfectamente el payment ID con el id_pedido
-- 2. El teléfono se guardará correctamente en pedido_telefono_cliente  
-- 3. El endpoint /numero-pedido podrá encontrar el pedido usando payment_id
-- 4. Se mostrarán los últimos 2 dígitos del id_pedido (P0001 → "01")

-- PROCEDURE: public.sp_crear_pedido_web(text, double precision, text, text, text, text, text)
-- Versión actualizada que guarda el payment ID de MercadoPago en metodo_pago
-- y permite correlacionar el payment ID con el id_pedido generado

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

  -- IMPORTANTE: Guardar también el payment ID en pedido_telefono_cliente temporal
  -- para poder correlacionar después (o usar otra columna disponible)
  UPDATE productos
  SET id_pedido = id_pedido_sp,
      id_pago = id_pago_sp,
      estado = estado_pedido_sp,
      pedido_fecha = CURRENT_TIMESTAMP,
      pedido_nombre_cliente = in_nombre_cliente,
      pedido_correo_cliente = in_correo_cliente,
      pedido_telefono_cliente = COALESCE(NULLIF(in_telefono_cliente, ''), payment_id_mp), -- Usar payment ID si no hay teléfono
      pedido_monto_total = in_monto_total,
      pedido_tipo_entrega = in_tipo_entrega
  WHERE id_articulo = ANY(string_to_array(in_id_productos, ',')::INT[]);

  -- Log para debugging
  RAISE NOTICE 'Pedido creado: id_pedido=%, payment_id=%, productos_actualizados=%', 
    id_pedido_sp, payment_id_mp, array_length(string_to_array(in_id_productos, ','), 1);
  
END;
$BODY$;

ALTER PROCEDURE public.sp_crear_pedido_web(text, double precision, text, text, text, text, text)
    OWNER TO neondb_owner;

-- Comentarios sobre los cambios:
-- 1. Extrae el payment ID del string "MercadoPago 122156582223"
-- 2. Guarda el payment ID en pedido_telefono_cliente si no hay teléfono
-- 3. Esto permite correlacionar el payment ID con el id_pedido generado
-- 4. El frontend podrá buscar por payment ID y obtener el id_pedido real (P0001, P0002, etc.)

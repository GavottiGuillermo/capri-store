-- STORED PROCEDURE CORREGIDO: sp_crear_pedido_web
-- Versión que incluye:
-- 1. Guardado correcto del teléfono en pedido_telefono_cliente
-- 2. Nueva columna mp_payment_id para correlacionar Payment ID de MercadoPago
-- 3. Parámetro adicional para el Payment ID

-- Primero, eliminar la versión anterior si existe
DROP PROCEDURE IF EXISTS public.sp_crear_pedido_web(text, double precision, text, text, text, text, text);
DROP PROCEDURE IF EXISTS public.sp_crear_pedido_web(text, double precision, text, text, text, text, text, text);

-- Crear la nueva versión con 8 parámetros
CREATE OR REPLACE PROCEDURE public.sp_crear_pedido_web(
	IN in_id_productos text,
	IN in_monto_total double precision,
	IN in_nombre_cliente text,
	IN in_correo_cliente text,
	IN in_telefono_cliente text,
	IN in_metodo_pago text,
	IN in_tipo_entrega text,
	IN in_mp_payment_id text DEFAULT NULL  -- Nuevo parámetro para Payment ID
)
LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
  id_pago_sp BIGINT;
  id_pedido_sp TEXT;
  ultimo_pedido_sp TEXT;
  nuevo_numero_pedido_sp INT;
  estado_pedido_sp TEXT;
  metodo_pago_completo TEXT;
BEGIN
  -- Validación del tipo de entrega
  IF in_tipo_entrega NOT IN ('Retiro','Envio') THEN
    RAISE EXCEPTION 'Tipo de entrega inválido: %', in_tipo_entrega;
  END IF;

  -- Validar que el teléfono no esté vacío (dato obligatorio)
  IF in_telefono_cliente IS NULL OR TRIM(in_telefono_cliente) = '' THEN
    RAISE EXCEPTION 'Teléfono del cliente es obligatorio';
  END IF;

  -- Crear metodo_pago completo incluyendo Payment ID si se proporciona
  IF in_mp_payment_id IS NOT NULL AND in_mp_payment_id != '' THEN
    metodo_pago_completo := in_metodo_pago || ' #' || in_mp_payment_id;
  ELSE
    metodo_pago_completo := in_metodo_pago;
  END IF;

  -- Insertar cliente (si no existe)
  INSERT INTO clientes (nombre_cliente, correo_cliente)
  VALUES (in_nombre_cliente, in_correo_cliente)
  ON CONFLICT DO NOTHING;

  -- Insertar pago con metodo_pago completo
  INSERT INTO pagos (fecha_pago, monto, nombre_cliente, metodo_pago)
  VALUES (CURRENT_DATE, in_monto_total, in_nombre_cliente, metodo_pago_completo)
  RETURNING id_pago INTO id_pago_sp;

  -- Obtener el último número de pedido
  SELECT p.id_pedido
  INTO ultimo_pedido_sp
  FROM productos p
  WHERE p.id_pedido IS NOT NULL
  ORDER BY CAST(SUBSTRING(p.id_pedido FROM 2) AS INT) DESC
  LIMIT 1;

  -- Generar nuevo número de pedido
  IF ultimo_pedido_sp IS NULL THEN
    nuevo_numero_pedido_sp := 1;
  ELSE
    nuevo_numero_pedido_sp := CAST(SUBSTRING(ultimo_pedido_sp FROM 2) AS INT) + 1;
  END IF;

  id_pedido_sp := 'P' || LPAD(nuevo_numero_pedido_sp::TEXT, 4, '0');

  -- Determinar estado según tipo de entrega
  estado_pedido_sp := CASE
    WHEN in_tipo_entrega = 'Retiro' THEN 'Pendiente Retiro'
    ELSE 'Pendiente Envio'
  END;

  -- Actualizar productos con TODOS los datos incluyendo teléfono y Payment ID
  UPDATE productos
  SET id_pedido = id_pedido_sp,
      id_pago = id_pago_sp,
      estado = estado_pedido_sp,
      pedido_fecha = CURRENT_TIMESTAMP,
      pedido_nombre_cliente = in_nombre_cliente,
      pedido_correo_cliente = in_correo_cliente,
      pedido_telefono_cliente = in_telefono_cliente, -- ¡TELÉFONO OBLIGATORIO!
      pedido_monto_total = in_monto_total,
      pedido_tipo_entrega = in_tipo_entrega,
      mp_payment_id = in_mp_payment_id  -- Payment ID en nueva columna
  WHERE id_articulo = ANY(string_to_array(in_id_productos, ',')::INT[]);

  -- Verificar cuántos productos se actualizaron
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontraron productos con los IDs proporcionados: %', in_id_productos;
  END IF;

  -- Log para debugging
  RAISE NOTICE 'Pedido creado exitosamente:';
  RAISE NOTICE '  - ID Pedido: %', id_pedido_sp;
  RAISE NOTICE '  - Payment ID: %', in_mp_payment_id;
  RAISE NOTICE '  - Teléfono: %', in_telefono_cliente;
  RAISE NOTICE '  - Cliente: %', in_nombre_cliente;
  RAISE NOTICE '  - Total: %', in_monto_total;
END;
$BODY$;

-- Asignar permisos
ALTER PROCEDURE public.sp_crear_pedido_web(text, double precision, text, text, text, text, text, text)
    OWNER TO neondb_owner;

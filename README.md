# Harbor — buscador de schedules

Prototipo web en español para comparar salidas de Maersk y CMA CGM. Sin dependencias npm: requiere Node.js 20 o posterior.

## Ejecutar localmente

1. Copia `.env.example` a `.env`.
2. Añade las credenciales de API emitidas por cada naviera.
3. Ejecuta `npm start` y abre `http://localhost:3000`.

Sin credenciales, el sitio se ejecuta en modo demostración y etiqueta las salidas como datos de muestra. No representa horarios reales.

## Publicar online desde GitHub

Este proyecto incluye backend Node.js para mantener las claves API fuera del navegador. **GitHub Pages no puede ejecutar este backend.** Para publicar la aplicación completa, despliega el repositorio como un servicio web Node (por ejemplo, Render) y configura las claves en el panel de variables secretas del hosting; no las subas a GitHub.

### Subir el código a GitHub

1. Crea un repositorio vacío en GitHub.
2. Desde esta carpeta, ejecuta:

   ```bash
   git init
   git add .
   git commit -m "Crear Harbor schedule search"
   git branch -M main
   git remote add origin https://github.com/USUARIO/REPOSITORIO.git
   git push -u origin main
   ```

3. En Render, selecciona **New → Web Service**, conecta el repositorio y confirma el `render.yaml` detectado. El servicio usa `npm start` y el puerto asignado por la plataforma.
4. En el panel de Render, define los valores API emitidos por las navieras como variables de entorno secretas. `CMA_ROUTING_PATH` debe ser el endpoint confirmado por la documentación Swagger de tu suscripción.
5. Al desplegar, Render entrega una URL pública `https://…onrender.com`. Revisa `/api/status` para ver si las credenciales están configuradas.

El archivo `render.yaml` prepara el servicio. El plan gratuito puede suspender instancias inactivas; verifica las condiciones vigentes del proveedor antes de usarlo con clientes.

## Integraciones

- **Maersk**: el servidor usa `GET https://api.maersk.com/products/ocean-products/point-to-point`, con `Consumer-Key` y los códigos de país/ciudad de origen y destino. El producto requiere una cuenta y Consumer Key del [Developer Portal](https://developer.maersk.com/support/faqs). Usa nombres de ciudad; verifica campos y restricciones de la especificación vigente en el portal.
- **CMA CGM**: el catálogo oficial publica el Routing Finder, protegido con API Key y OAuth2. El esquema de acceso/entorno se configura mediante `CMA_API_KEY`, opcionalmente `CMA_CLIENT_ID`, `CMA_CLIENT_SECRET`, `CMA_TOKEN_URL`, `CMA_ROUTING_URL` y `CMA_ROUTING_PATH`. La URL y los parámetros de consulta pueden variar según la suscripción: confirma los valores exactos en Swagger del producto antes de producción.

Las credenciales se leen en el servidor; nunca se pasan al navegador. El adaptador CMA está preparado para conectarse una vez que la naviera habilite la suscripción y se confirme su base URL, endpoint y nombres de parámetros. Los portales oficiales pueden requerir aprobación y no garantizan que el acceso gratuito permita uso comercial o redistribución de los schedules.

## Archivos

- `server.js`: servidor estático, endpoints internos y adaptadores de navieras.
- `index.html`, `styles.css`, `app.js`: interfaz de búsqueda adaptable a móvil.

Antes de publicar para clientes, valida autorización de uso/redistribución, mapeo de puertos a UN/LOCODE, parámetros CMA CGM, tasas/límites, autenticación de usuarios y protección de credenciales con el equipo de seguridad.

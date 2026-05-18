# Organigrama privado ePayco

Aplicación React para consultar y administrar el organigrama interno de ePayco con React Flow, Supabase Auth y Supabase RLS.

## Ejecutar localmente

```bash
npm install
npm run dev
```

Si no existen variables de Supabase, la aplicación inicia en modo demo local con datos importados desde la base maestra. El modo demo solo corre en desarrollo local; los builds de producción no exponen la semilla demo.

## Variables de entorno

Crea `.env.local`:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
VITE_CORPORATE_DOMAIN=epayco.com
VITE_ADMIN_EMAIL=julian.tobon@epayco.com
```

## Supabase

1. Ejecuta `supabase/schema.sql` en el SQL editor de Supabase.
2. Ejecuta `supabase/seed_from_github.sql` para cargar la base inicial del organigrama.
3. Activa Magic Link o proveedor Google/Microsoft en Supabase Auth.
4. En Authentication > URL Configuration, configura el Site URL de producción y agrega también las URLs locales de desarrollo.
5. La regla de lectura permite usuarios autenticados con correo `@epayco.com`.
6. Solo `julian.tobon@epayco.com` queda como administrador inicial con permisos de carga, edición e historial.

URLs recomendadas de Auth:

- Producción: `https://jt-desing.github.io/organigrama-epayco/`
- Local: `http://localhost:5173/`
- Local alterna: `http://127.0.0.1:5173/`

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` despliega `dist` con GitHub Actions. Configura estos secretos del repositorio antes de usar Pages con Supabase real:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Variables opcionales:

- `VITE_CORPORATE_DOMAIN=epayco.com`
- `VITE_ADMIN_EMAIL=julian.tobon@epayco.com`

## Carga masiva

El panel administrativo acepta `.xlsx` y `.csv`. Reconoce columnas:

- `nombre`, `nombre completo` o `nombre mostrado`
- `cargo`, `posición` o `nombre posición`
- `correo` o `email`
- `departamento` o `nombre departamento`
- `jefe directo`
- `estado`
- `orden departamento`
- `orden jerárquico`
- `nivel jerárquico`
- `subárea`
- `grupo`
- `persona id sugerido`
- `parent id sugerido`

Todos los correos importados se normalizan a `@epayco.com`. Si una fila no trae correo, la aplicación genera uno desde el nombre para mantener una llave estable durante la comparación.

Antes de aplicar cambios muestra nuevas personas, actualizaciones, personas ausentes que se marcarán inactivas, nuevos departamentos, cambios de cargo, cambios de departamento, cambios de jefe y errores/duplicados.

La semilla demo local fue regenerada desde `ORGANIGRAMA_EPAYCO_MAESTRO_COMPLETO_FINAL.xlsx`, usando departamentos, subáreas, grupos, jefes directos y orden global para ordenar el canvas.

Para regenerarla con una nueva base maestra:

```bash
npm run generate:seed -- "C:\ruta\al\archivo.xlsx"
```
  

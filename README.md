# Organigrama ePayco

Aplicación React para consultar el organigrama interno de ePayco con React Flow. La app entra directo al canvas, sin autenticación previa.

## Ejecutar localmente

```bash
npm install
npm run dev
```

La aplicación incluye una base local generada desde la base maestra para evitar pantallas vacías. Si Supabase está configurado y permite lectura pública, la app sincroniza departamentos y personas desde la base remota.

## Variables de entorno

Crea `.env.local`:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
VITE_CORPORATE_DOMAIN=epayco.com
VITE_ENABLE_PUBLIC_ADMIN=false
```

## Supabase

1. Ejecuta `supabase/schema.sql` en el SQL editor de Supabase.
2. Ejecuta `supabase/seed_from_github.sql` para cargar la base inicial del organigrama.
3. El esquema permite lectura pública de departamentos y personas activas para que el organigrama cargue sin autenticación.
4. Las escrituras siguen restringidas por RLS a usuarios autenticados/admin si más adelante se reactiva administración remota.

Para validar que la URL y la llave apuntan a un proyecto activo:

```bash
npm run check:supabase
```

Si el comando falla en DNS, `VITE_SUPABASE_URL` no apunta a un proyecto Supabase activo o el proyecto esta pausado/eliminado. La app seguirá mostrando la base local incluida.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` despliega `dist` con GitHub Actions. Supabase es opcional; si no configuras estos secretos, la app usa la base local incluida:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Variables opcionales:

- `VITE_CORPORATE_DOMAIN=epayco.com`
- `VITE_ENABLE_PUBLIC_ADMIN=false`

## Carga masiva

El panel administrativo acepta `.xlsx` y `.csv`. En producción queda oculto por defecto porque no hay login; solo se muestra si compilas con `VITE_ENABLE_PUBLIC_ADMIN=true`. Reconoce columnas:

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
  

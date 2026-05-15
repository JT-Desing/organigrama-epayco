# IPQ Organigrama Privado

Aplicacion React para consultar y administrar el organigrama interno de IPQ con React Flow, Supabase Auth y Supabase RLS.

## Ejecutar localmente

```bash
npm install
npm run dev
```

Si no existen variables de Supabase, la aplicacion inicia en modo demo local con datos importados desde `bd organigrama.ods`.
El modo demo solo corre en desarrollo local; los builds de produccion no exponen la semilla demo.

## Variables de entorno

Crea `.env.local`:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
VITE_CORPORATE_DOMAIN=ipq.com.co
```

## Supabase

1. Ejecuta `supabase/schema.sql` en el SQL editor de Supabase.
2. Cambia `admin@ipq.com.co` por el correo real del primer administrador.
3. Activa Magic Link o proveedor Google/Microsoft en Supabase Auth.
4. Agrega los correos autorizados en `authorized_users`.
5. Despliega el frontend en Vercel, Netlify o GitHub Pages con las variables anteriores.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` despliega `dist` con GitHub Actions. Configura estos secretos del repositorio antes de usar Pages:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Y opcionalmente la variable:

- `VITE_CORPORATE_DOMAIN=ipq.com.co`

## Carga masiva

El panel administrativo acepta `.xlsx` y `.csv`. Reconoce columnas:

- `nombre`, `nombre completo` o `nombre mostrado`
- `cargo`, `posicion` o `nombre posicion`
- `correo` o `email`
- `departamento` o `nombre departamento`
- `jefe directo`
- `estado`
- `orden departamento`
- `orden jerarquico`
- `nivel jerarquico`

Antes de aplicar cambios muestra nuevas personas, actualizaciones, personas ausentes que se marcaran inactivas, nuevos departamentos, cambios de cargo, cambios de departamento, cambios de jefe y errores/duplicados.

La semilla demo local fue regenerada desde `bd_organigrama_orden_jerarquico.xlsx`, usando `Orden Departamento`, `Orden Jerarquico` y `Nivel Jerarquico` para ordenar el canvas.

# Design System — Inteliside v2 Editorial · Light Mode

> Esta UI usa el **Inteliside Design System v2 (Editorial, inspirado en Anthropic)** en **Modo Light**.
>
> **Fuente de verdad (canonica):** `~/.claude/skills/inteliside-design/` (symlink a `~/Documents/Inteliside/Design-System-v2/`).
>
> Archivos clave del skill:
> - `SKILL.md` — instrucciones para el agente disenador
> - `README.md` — overview del sistema v2
> - `colors_and_type.css` — tokens autoritativos (CSS variables) + `.surface-*` classes + utilities (`.btn`, `.link-editorial`, `.eyebrow`, `.lead`, `.serif-italic`, etc.)
> - `preview/` — HTML de cada componente para verlo en vivo
> - `ui_kits/marketing-site/` y `ui_kits/documents/` — landing y A4 propuesta como referencia visual
>
> **Importante:** v2 es un sistema completamente distinto al manual de marca v1.0 (`Manual-Marca-Corporativo-Inteliside-v1.0.md`). El v1 es legacy. Este proyecto sigue v2.

---

## Modo de operacion

Para este proyecto: **light mode default**, sin toggle dark/system en MVP. Esto se logra con `<html class="light">` y nada mas.

```html
<html lang="es" class="light">
```

(El sistema soporta `light | dark | system` — pero el demo usa solo light por simplicidad. Si en algun pitch un prospect lo pide en dark, es flip de class, todos los tokens funcionan.)

---

## Tokens autoritativos (Light)

Estos son los valores reales del CSS del skill. NO inventarlos, NO sustituirlos:

### Brand primitives

```
Teal accent (acento unico)    --teal-500   #2D9AA5
Teal hover                    --teal-600   #268590
Teal soft (washes)            --teal-50    #EAF4F5
Teal wash (backgrounds)       --accent-wash rgba(45, 154, 165, 0.08)
```

### Ivory scale (warm neutrals — backgrounds & elevations)

```
Ivory 50  (cards elevated)    #FAF7F2   ← --bg-elevated
Ivory 100 (CANVAS principal)  #F5F1EB   ← --bg
Ivory 200 (subtle bg)         #EDE8DE   ← --bg-subtle
Ivory 300                     #E0D9CC
Ivory 400                     #C9C0B0
Ivory 500                     #A89F8E
```

**Esto es lo MAS importante:** el fondo NO es blanco puro. Es **ivory warm `#F5F1EB`**. Esto distingue al sistema y le da el feel editorial/Anthropic.

### Foreground (warm inks)

```
fg principal                  #141210   ← --fg
fg muted                      #4A453D   ← --fg-muted
fg subtle                     #7A7366   ← --fg-subtle
fg inverse (sobre teal)       #FAF7F2   ← --fg-inverse
```

### Hairlines (reglas / divisores)

```
rule normal                   rgba(20, 18, 16, 0.14)
rule soft                     rgba(20, 18, 16, 0.08)
rule strong                   rgba(20, 18, 16, 0.30)
```

**Regla dura:** la jerarquia visual se construye con HAIRLINES (lineas de 1px en `var(--rule)`) y ESPACIO EN BLANCO. **NO con shadows.** El sistema tiene `--shadow-soft` y `--shadow-lift` definidos pero su uso es minimo y estrictamente para elevaciones especiales (no para cards comunes).

### Tokens funcionales para estados de la decision

El sistema v2 no define semantic colors explicitos para credit decisions. Defaults sensatos alineados al espiritu warm/terroso del v2:

```
APPROVED:   bg #EAF4F5    text #1F6F78    label "Aprobada"
REJECTED:   bg #F2E0DC    text #B64545    label "Rechazada"
REVIEW:     bg #F5EFE0    text #C67E2F    label "Revisar"
```

Estos coinciden con las "semantics terrosas" del README v2 (success `#5A8A42`, warning `#C67E2F`, danger `#B64545`).

---

## Tipografia

**3 familias, cada una con rol especifico:**

```
Serif (display, H1, H2, lead, italics)   Fraunces (Google Fonts, variable, opsz 9..144)
Sans (H3, H4, body, UI, buttons)         Geist (100..700)
Mono (eyebrows, meta, code, IDs)         Geist Mono (400, 500)
```

**Fallbacks:**

```css
--font-serif:  "Fraunces", "Source Serif 4", "Iowan Old Style", Georgia, serif;
--font-sans:   "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono:   "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

### Escala fluida (clamp para responsive)

| Token | Tamano | Uso |
|---|---|---|
| `--fs-display` | clamp(48px, 7vw, 104px) | Hero sections, portadas |
| `--fs-h1` | clamp(36px, 5vw, 68px) | Titulo principal de pagina (Fraunces) |
| `--fs-h2` | clamp(28px, 3.4vw, 44px) | Titulo de seccion (Fraunces) |
| `--fs-h3` | 24px | Subseccion (Geist Medium) |
| `--fs-h4` | 18px | Sub-subseccion (Geist Medium) |
| `--fs-lead` | clamp(18px, 1.5vw, 22px) | Parrafo lead (Fraunces ITALIC) |
| `--fs-body` | 17px | Body principal — editorial |
| `--fs-body-sm` | 15px | Body secundario |
| `--fs-meta` | 13px | Meta info |
| `--fs-micro` | 11px | Eyebrows mono uppercase |

**Pesos:**

```
Thin 100, Extralight 200, Light 300, Regular 400, Medium 500, SemiBold 600
```

### Reglas tipograficas duras

1. **H1 y H2 son SIEMPRE serif (Fraunces)**, peso Regular 400, tracking negativo (`-0.04em` para display, `-0.02em` para H2). Nada de Geist en H1/H2.
2. **H3 y H4 son sans (Geist) Medium 500.**
3. **Body es Geist Regular 400** a 17px (editorial big), line-height 1.6.
4. **Lead** (parrafo intro debajo del H1) es **Fraunces italic** 18-22px, color `--fg-muted`. Es el patron caracteristico del sistema.
5. **Eyebrows / meta** (lineas tipo `INVESTIGACION · 14 ABR 2026 · 7 MIN LECTURA`) son **Geist Mono uppercase**, 11px, tracking `0.08em`, color `--fg-subtle` o `--accent` para la categoria. Reemplazan los viejos `SRV_1:3` tags.

### Patron editorial-meta (caracteristico del sistema)

```html
<div class="entry-meta">
  <span class="cat">DECISION DE CREDITO</span>
  <span>·</span>
  <span>14 ABR 2026</span>
  <span>·</span>
  <span>v0 INTAKE</span>
</div>
```

Este patron debe aparecer en cabeceras de cards de solicitudes, paneles de trace, etc. Le da al producto el aire editorial.

---

## Componentes UI (specs autoritativas del CSS del skill)

### Botones

```css
/* Primario (CTA) */
.btn-primary {
  background: var(--accent);          /* #2D9AA5 */
  color: var(--fg-inverse);           /* #FAF7F2 ivory casi blanco */
  border-radius: var(--r-md);         /* 6px — NO 8px! */
  padding: 12px 22px;
  font-family: Geist, font-weight: 500;
  font-size: 15px;
}
.btn-primary:hover {
  background: var(--accent-hover);    /* #268590 */
  transform: translateY(-1px);
}

/* Ghost (secundario, outline) */
.btn-ghost {
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--rule-strong);
  /* hover: border-color #141210, background var(--accent-wash) */
}

/* Text only (link as button) */
.btn-text {
  background: transparent;
  color: var(--fg);
  padding: 8px 0;
  /* hover: color: var(--accent) */
}
```

**Radius dura:** botones usan `var(--r-md)` = **6px**. NO usar 8px (era v1). NO pills.

### Cards

```css
/* No hay clase .card universal en v2. La elevacion se hace con: */
.card {
  background: var(--bg-elevated);     /* #FAF7F2 */
  border-top: 1px solid var(--rule);  /* hairline arriba */
  border-bottom: 1px solid var(--rule); /* hairline abajo */
  padding: var(--s-6) var(--s-8);     /* 24px 32px */
  /* SIN border-radius (o muy sutil --r-sm 4px) */
  /* SIN box-shadow */
}
```

Para cards con mas peso, usar `var(--r-lg)` = 10px de radius. Pero el patron editorial favorece **hairlines arriba/abajo sin radius** (vibe periodico).

### Links editoriales (signature del sistema)

```css
.link-editorial {
  color: var(--fg);
  text-decoration: none;
  background-image: linear-gradient(var(--accent), var(--accent));
  background-repeat: no-repeat;
  background-size: 0% 1px;
  background-position: 0 100%;
  transition: background-size 320ms cubic-bezier(0.4, 0, 0.2, 1);
}
.link-editorial:hover {
  background-size: 100% 1px;          /* underline crece de 0→100% */
  color: var(--accent);
}
```

**Esto es el tratamiento default de todo link.** No usar `text-decoration: underline` directo.

### Hairlines

```css
.hairline {
  border: 0;
  height: 1px;
  background: var(--rule);
  margin: 0;
}
.hairline-soft { background: var(--rule-soft); }
```

Estos reemplazan toda situacion donde antes hubiese borde de card o separator.

### Iconos

- **Sistema:** Solar linework (Iconify). 24×24, stroke 1.3, remates redondos.
- **En React:** usar `@iconify/react` con set `solar:*-linear`. Ej: `<Icon icon="solar:server-square-linear" />`.
- **Color:** `currentColor` (hereda del padre) o `var(--accent)` para jerarquia.
- **Alternativa simpler:** Lucide React si Solar no esta disponible — pero priorizar Solar para fidelidad de marca.

### Chip / Badge

```css
.chip-teal {
  background: var(--accent-wash);     /* rgba(45, 154, 165, 0.08) */
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 4px 10px;
  border-radius: var(--r-xs);         /* 2px — sutil */
}
```

---

## Setup concreto en el proyecto

### Opcion A — usar el CSS del skill directamente

Copy `colors_and_type.css` del skill al proyecto y linkearlo:

```bash
cp ~/.claude/skills/inteliside-design/colors_and_type.css apps/web/styles/inteliside-ds.css
```

En `app/layout.tsx`:

```tsx
import './globals.css';
import '@/styles/inteliside-ds.css';
import { Geist, Geist_Mono } from 'geist/font';
import { Fraunces } from 'next/font/google';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  axes: ['opsz'],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`light ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

`pnpm add geist` para Geist y Geist Mono. Fraunces via `next/font/google`.

### Opcion B — traducir tokens a Tailwind config

Si shadcn/ui esta instalado y queremos consistencia con utility classes, mapear los tokens v2 a `tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // v2 brand
        ivory: {
          50: '#FAF7F2',
          100: '#F5F1EB',  // canvas
          200: '#EDE8DE',
          300: '#E0D9CC',
          400: '#C9C0B0',
          500: '#A89F8E',
        },
        ink: {
          50: '#1C1A17',
          100: '#141210',
          200: '#0F0D0B',
          900: '#070605',
        },
        teal: {
          50: '#EAF4F5',
          100: '#D1E7EA',
          500: '#2D9AA5',
          600: '#268590',
          700: '#1F6F78',
        },
        // semantic aliases (light mode)
        bg: '#F5F1EB',
        'bg-elevated': '#FAF7F2',
        'bg-subtle': '#EDE8DE',
        fg: '#141210',
        'fg-muted': '#4A453D',
        'fg-subtle': '#7A7366',
        'fg-inverse': '#FAF7F2',
        accent: '#2D9AA5',
        'accent-hover': '#268590',
        // decision states
        decision: {
          approved: { bg: '#EAF4F5', text: '#1F6F78' },
          rejected: { bg: '#F2E0DC', text: '#B64545' },
          review:   { bg: '#F5EFE0', text: '#C67E2F' },
        },
      },
      borderRadius: {
        xs: '2px',
        sm: '4px',
        md: '6px',     // botones
        DEFAULT: '6px',
        lg: '10px',
        xl: '14px',
      },
      fontFamily: {
        serif: ['Fraunces', 'Source Serif 4', 'Iowan Old Style', 'Georgia', 'serif'],
        sans: ['Geist', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tighter: '-0.04em',  // display
        tight: '-0.02em',    // h2
        body: '-0.005em',    // body
        mono: '0.08em',      // eyebrows
      },
      lineHeight: {
        tight: '1.05',
        snug: '1.15',
        relaxed: '1.6',
        article: '1.7',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
```

**Recomendacion para este proyecto:** **Opcion A (CSS directo)**. Razon: el sistema es tan especifico (Fraunces variable axes, opsz settings, letter-spacing fluido, link-editorial hover, etc.) que traducir todo a Tailwind utilities perdimos fidelidad. Importamos el CSS completo y usamos las clases del sistema (`.btn`, `.lead`, `.eyebrow`, `.link-editorial`, `.hairline`, `.entry-meta`, `.serif-italic`). shadcn/ui se instala igual pero sus componentes los re-clasamos con tokens del v2.

---

## Configuracion de shadcn/ui (cuando llegue su slice)

Cuando inicialices shadcn:

```bash
pnpm dlx shadcn@latest init
```

Responder:
- TypeScript: yes
- Style: **default** (no new-york, queremos fidelidad propia)
- Base color: **stone** (mas cercano al ivory que neutral o slate)
- CSS variables: **yes**
- Tailwind prefix: vacio
- React Server Components: **yes**

Despues del init, **sobreescribir las CSS variables de shadcn** en `globals.css` con los valores del v2 (no los defaults de shadcn). Plantilla:

```css
@layer base {
  :root, .light {
    --background: 245 241 235;          /* #F5F1EB ivory canvas */
    --foreground: 20 18 16;              /* #141210 warm ink */
    --card: 250 247 242;                 /* #FAF7F2 elevated ivory */
    --card-foreground: 20 18 16;
    --popover: 250 247 242;
    --popover-foreground: 20 18 16;
    --primary: 45 154 165;               /* #2D9AA5 teal */
    --primary-foreground: 250 247 242;
    --secondary: 237 232 222;            /* #EDE8DE subtle */
    --secondary-foreground: 20 18 16;
    --muted: 237 232 222;
    --muted-foreground: 74 69 61;        /* #4A453D */
    --accent: 234 244 245;               /* #EAF4F5 teal wash */
    --accent-foreground: 31 111 120;     /* #1F6F78 */
    --destructive: 182 69 69;            /* #B64545 warm danger */
    --destructive-foreground: 250 247 242;
    --border: 20 18 16 / 0.14;           /* hairline rule */
    --input: 20 18 16 / 0.14;
    --ring: 45 154 165;                  /* teal focus */
    --radius: 0.375rem;                  /* 6px */
  }
}
```

Y los componentes shadcn que se instalen (button, card, input) van a tomar automatico esos tokens.

---

## Reglas duras visuales (NO violar)

1. **Fondo NO es blanco puro.** Es ivory `#F5F1EB`. Esta es la diferencia mas obvia con el v1.
2. **Tipografia: 3 familias obligatorias** — Fraunces (display/H1/H2), Geist (body/H3/H4), Geist Mono (eyebrows). Faltar Fraunces = no es Inteliside v2.
3. **Italics editoriales en serif.** Cuando algo se enfatiza dentro de body, usar `<span class="serif-italic">` no `<em>` simple.
4. **Eyebrows mono uppercase.** Toda metadata (categoria, fecha, version, tipo) va con `class="eyebrow"` — Geist Mono 11px uppercase tracking wide.
5. **Hairlines, NO shadows.** Para separar contenido o indicar elevacion, usar `<hr class="hairline">` o `border-top: 1px solid var(--rule)`. Reservar shadows solo para overlays/modals (raro en este demo).
6. **Teal `#2D9AA5` solo como acento.** Links, primary CTA, eyebrow categoria, KPIs grandes, focus ring. NUNCA como background de seccion.
7. **Sin emojis.** Ni en UI ni en copy. Ni siquiera "decorativos". Solo iconos Solar.
8. **Copy en espanol, segunda persona informal.** "Tu solicitud" no "su solicitud", salvo en contratos legales (no aplica aca).
9. **Maximo 3 colores en una vista** — ivory bg, ink fg, teal accent. Los grises (`--fg-muted`, `--fg-subtle`) y borders (`--rule`) no cuentan como color.
10. **Animaciones controladas.** `--dur-base 320ms` con `--ease-smooth`. Hover de botones: `translateY(-1px)`. Hover de links: underline crece 0→100%. Nada mas dramatico.

---

## Anti-patrones (cosas que el v1 hacia y v2 NO)

- ❌ Fondo `#FFFFFF` puro — usar ivory `#F5F1EB`
- ❌ Solo Geist sin serif — usar Fraunces para H1/H2
- ❌ `box-shadow: 0 2px 8px rgba(0,0,0,0.06)` en cards — usar hairlines
- ❌ Border radius 8px en botones — usar 6px (`--r-md`)
- ❌ `border-radius: 9999px` (pills) en badges — usar `--r-xs` 2px y mono uppercase
- ❌ Stroke icons genericos (Lucide) sin curaduria — preferir Solar `*-linear`
- ❌ Geist Thin (100) — minimo Regular en light mode, Medium para H3/H4

---

## Patron del header del demo

Default para slice 1 (light mode, sin franja):

```html
<header class="hairline-bottom">
  <div class="entry-meta">
    <span class="cat">DEMO</span>
    <span>·</span>
    <span>COOPERATIVA AHORRO Y CREDITO</span>
  </div>
  <h1>coop-credit-agent</h1>
  <p class="lead">Decisión sugerida de microcrédito con arquitectura multi-agente apta para producción.</p>
</header>
```

Renderizado:
- Eyebrow mono `DEMO · COOPERATIVA AHORRO Y CREDITO` (categoria en teal)
- H1 grande en Fraunces (`coop-credit-agent`)
- Lead en Fraunces italic muted explicando que es
- Hairline abajo separa de contenido

Logo: usar `~/.claude/skills/inteliside-design/uploads/Logo-Inteliside-Dark.svg` (version oscura para fondos claros). Copiarlo a `public/inteliside-logo.svg` del proyecto.

---

## Cuando dudar — abrir los previews

El skill incluye `preview/*.html` con todos los componentes visualmente. Si una decision visual no esta clara, abrir el HTML correspondiente en navegador:

```bash
open ~/.claude/skills/inteliside-design/preview/components-buttons.html
open ~/.claude/skills/inteliside-design/preview/components-card.html
open ~/.claude/skills/inteliside-design/preview/type-headings.html
```

Y para ver el sistema completo en accion:

```bash
open ~/.claude/skills/inteliside-design/ui_kits/marketing-site/index.html
open ~/.claude/skills/inteliside-design/ui_kits/documents/index.html
```

Estos son la referencia visual. La regla es: **el demo se debe ver como esos previews**.

---

*Esta regla aplica a TODA la UI del proyecto. Cuando una slice de UI proponga un componente, validar contra esta regla y los previews del skill antes de codear.*

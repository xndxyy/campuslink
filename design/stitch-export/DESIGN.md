---
name: CampusLink
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#444651'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#757682'
  outline-variant: '#c5c5d3'
  surface-tint: '#4059aa'
  primary: '#00236f'
  on-primary: '#ffffff'
  primary-container: '#1e3a8a'
  on-primary-container: '#90a8ff'
  inverse-primary: '#b6c4ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#262b2e'
  on-tertiary: '#ffffff'
  tertiary-container: '#3c4144'
  on-tertiary-container: '#a8adb1'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b6c4ff'
  on-primary-fixed: '#00164e'
  on-primary-fixed-variant: '#264191'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#dfe3e7'
  tertiary-fixed-dim: '#c3c7cb'
  on-tertiary-fixed: '#171c1f'
  on-tertiary-fixed-variant: '#43474b'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  container-max: 1280px
  gutter: 24px
---

## Brand & Style
The design system is built for a vibrant, academic ecosystem that balances institutional reliability with the energy of student life. The brand personality is "The Helpful Senior"—knowledgeable and structured, yet approachable and modern. 

The aesthetic follows a **Corporate-Modern** direction with **Minimalist** influences. It prioritizes clarity through a rigorous grid system, punctuated by soft, friendly UI elements to avoid a sterile "institutional" feel. The emotional response should be one of confidence and ease, reducing the cognitive load of navigating complex campus resources.

## Colors
The palette is rooted in **Academic Blue (#1E3A8A)** to establish authority and trust. This is contrasted by **Energetic Green (#10B981)**, used as a functional accent for success states, active indicators, and high-engagement touchpoints to inject vitality into the interface.

The neutral scale relies heavily on Slate and Sky grays to maintain a clean, airy feel. Surface colors utilize off-whites to reduce eye strain during long study sessions. Text contrast adheres to WCAG AA standards, ensuring that the hierarchy between primary information and secondary metadata is immediate and intuitive.

## Typography
The design system utilizes **Inter** for all roles to achieve a systematic, utilitarian aesthetic that remains highly legible at small sizes. 

- **Headlines:** Use tight letter-spacing and bold weights to create strong visual anchors.
- **Body Text:** Set with generous line-height to facilitate scanning of long resource descriptions or announcements.
- **Data/Labels:** Use medium weights and slightly increased letter-spacing for meta-information like timestamps or category tags.

## Layout & Spacing
The layout employs a **Fluid Grid** system with fixed maximum widths for desktop to maintain readability. 

- **Desktop:** 12-column grid with 24px gutters and 40px side margins.
- **Tablet:** 8-column grid with 20px gutters and 24px side margins.
- **Mobile:** 4-column grid with 16px gutters and 16px side margins.

Spacing follows a strict 4pt base unit. Vertical rhythm is maintained by using the `md` (24px) unit for component grouping and `lg` (40px) for section padding.

## Elevation & Depth
Depth is expressed through **Tonal Layers** and **Ambient Shadows**. This design system avoids harsh borders in favor of soft shadows that suggest physical stacking.

- **Level 0 (Base):** Background color (#F8FAFC).
- **Level 1 (Cards/Lists):** White surface with a very soft, diffused shadow (0px 4px 12px rgba(0,0,0,0.05)).
- **Level 2 (Dropdowns/Modals):** White surface with a more defined shadow (0px 10px 25px rgba(0,0,0,0.1)).
- **Interactive States:** On hover, cards should lift slightly (transitioning shadow) to provide tactile feedback.

## Shapes
The shape language is defined by a **Rounded** philosophy. Standard elements use a 0.5rem (8px) radius, while larger containers like feature cards and search inputs use a "Large" 1rem (16px) radius to emphasize the "friendly" brand attribute. 

Avatars and specific status chips should remain fully circular (pill-shaped) to distinguish them from structural content containers.

## Components
- **Buttons:** Primary buttons use the Academic Blue background with white text. They feature a generous horizontal padding (24px) and 8px rounded corners.
- **Search Bar:** A prominent, high-radius (16px) input field with a soft Level 1 shadow and a subtle interior glass effect or light-gray fill.
- **Feature Cards:** High-impact containers for the three main sections. These should use a subtle gradient background or a large illustrative icon in the corner to differentiate from standard item listings.
- **Item Listings:** Clean, horizontal rows with 1px border-bottom or 12px spacing between them. Metadata (date, category) should use the `label-sm` style in neutral gray.
- **Chips:** Small, pill-shaped tags used for categories (e.g., "Library," "Housing"). Use the secondary Energetic Green at 10% opacity with 100% opacity text for high legibility and a modern look.
- **Navigation Bar:** A sticky top-bar with a blur effect (Backdrop Filter) and a subtle bottom border. It integrates a clear profile trigger and a global search icon.
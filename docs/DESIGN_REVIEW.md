# Calendar design review

The original annual calendar, embedded occasions, data integration, roles, notes, replies, archive and printing remain the baseline. This branch adds a screen-only stylesheet and progressive enhancements. It does not migrate storage or change authentication.

## References inspected
- https://21st.dev/community/components/s/calendar
- https://21st.dev/@sean0205/components/reui-event-calendar/variant-3
- https://21st.dev/@aloksivastava1025/components/cue-cell-to-card-calendar-expansion
- https://21st.dev/community/components/s/notification

ReUI is a candidate for a later React migration, not a drop-in replacement for the current single HTML application. The complete component source on 21st requires an account; no gated source has been copied. The current enhancement is original CSS inspired by the layout patterns.

## Decisions
| Area | Alternatives | Initial implementation |
| --- | --- | --- |
| Calendar | Full event calendar; compact picker; annual overview | Preserve annual overview and increase readability |
| Icons | Text only; outline icons; filled symbols | Lucide outline icons with persistent Arabic labels |
| Motion | Card expansion; subtle dialog entry; 3D flips | 220ms dialog entrance; no repeating effects; reduced-motion support |
| Notifications | Toast only; persistent inbox; bell panel | Preserve inbox and bell panel; improve panel spacing; announce toast accessibly |

## Pending validation and work
- Browser verification at mobile and desktop widths, including printing.
- User comparison of icon weight, dialog motion and notification presentation.
- Secure individual accounts, dynamic departments and year activation/archive.
- Drive uploads and authorization; Supabase metadata only; Render setup.
- Verify official occasion dates per year; sample dates must never become authoritative.
- Do not treat a frontend refresh as completion of the backend migration.

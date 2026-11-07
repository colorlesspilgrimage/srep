<script lang="ts">
  import Ban from 'lucide-svelte/icons/ban';
  import BookOpen from 'lucide-svelte/icons/book-open';
  import Check from 'lucide-svelte/icons/check';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import Eye from 'lucide-svelte/icons/eye';
  import Fingerprint from 'lucide-svelte/icons/fingerprint';
  import FolderInput from 'lucide-svelte/icons/folder-input';
  import FolderTree from 'lucide-svelte/icons/folder-tree';
  import GalleryHorizontal from 'lucide-svelte/icons/gallery-horizontal';
  import KeyRound from 'lucide-svelte/icons/key-round';
  import Layers from 'lucide-svelte/icons/layers';
  import LogOut from 'lucide-svelte/icons/log-out';
  import Pencil from 'lucide-svelte/icons/pencil';
  import Plus from 'lucide-svelte/icons/plus';
  import ChartColumn from 'lucide-svelte/icons/chart-column';
  import Search from 'lucide-svelte/icons/search';
  import Settings from 'lucide-svelte/icons/settings';
  import Shield from 'lucide-svelte/icons/shield';
  import Sparkles from 'lucide-svelte/icons/sparkles';
  import SquarePen from 'lucide-svelte/icons/square-pen';
  import Tag from 'lucide-svelte/icons/tag';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Undo2 from 'lucide-svelte/icons/undo-2';

  // Contract: named Lucide icons for the app chrome. Decorative; pass aria on the control.

  export type AppIconName =
    | 'decks'
    | 'study'
    | 'browse'
    | 'stats'
    | 'settings'
    | 'gallery'
    | 'security'
    | 'logout'
    | 'plus'
    | 'folder'
    | 'pencil'
    | 'trash'
    | 'note'
    | 'chevron'
    | 'brand'
    | 'undo'
    | 'suspend'
    | 'reveal'
    | 'passkey'
    | 'key'
    | 'tag'
    | 'move'
    | 'check'
    | 'search';

  type Props = {
    name: AppIconName;
    size?: number;
  };

  type LucideIcon = typeof Layers;

  const ICONS: Record<AppIconName, LucideIcon> = {
    decks: Layers,
    study: BookOpen,
    browse: Search,
    stats: ChartColumn,
    settings: Settings,
    gallery: GalleryHorizontal,
    security: Shield,
    logout: LogOut,
    plus: Plus,
    folder: FolderTree,
    pencil: Pencil,
    trash: Trash2,
    note: SquarePen,
    chevron: ChevronRight,
    brand: Sparkles,
    undo: Undo2,
    suspend: Ban,
    reveal: Eye,
    passkey: Fingerprint,
    key: KeyRound,
    tag: Tag,
    move: FolderInput,
    check: Check,
    search: Search,
  };

  let { name, size = 16 }: Props = $props();
  const Icon = $derived(ICONS[name]);
</script>

<span class="app-icon" aria-hidden="true">
  <Icon {size} strokeWidth={1.75} />
</span>

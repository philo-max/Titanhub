import { MediaItem } from '@titanhub/plugin-types';

export const mockCategories = ['anime', 'manga', 'novel', 'movie'] as const;
export type Category = (typeof mockCategories)[number];

export const mockMediaData: Record<Category, MediaItem[]> = {
  anime: [
    {
      id: 'anime-1',
      title: 'Neon Genesis: Rebuild',
      cover: '/images/poster.png',
      description: 'The final chapter of the epic mecha saga.',
      updateInfo: 'Completed',
    },
    {
      id: 'anime-2',
      title: 'Cyberpunk: Edgerunners',
      cover: '/images/poster.png',
      description:
        'A street kid trying to survive in a technology and body modification-obsessed city of the future.',
      updateInfo: 'Episode 10',
    },
    {
      id: 'anime-3',
      title: 'Jujutsu Kaisen',
      cover: '/images/poster.png',
      description:
        'A boy swallows a cursed talisman - the finger of a demon - and becomes cursed himself.',
      updateInfo: 'Episode 24',
    },
    {
      id: 'anime-4',
      title: 'Demon Slayer',
      cover: '/images/poster.png',
      description: 'A family is attacked by demons and only two members survive.',
      updateInfo: 'Episode 11',
    },
  ],
  manga: [
    {
      id: 'manga-1',
      title: 'Berserk',
      cover: '/images/poster.png',
      description:
        'Guts, a former mercenary now known as the "Black Swordsman", is out for revenge.',
      updateInfo: 'Chapter 373',
    },
    {
      id: 'manga-2',
      title: 'Chainsaw Man',
      cover: '/images/poster.png',
      description: 'Denji has a simple dream—to live a happy and peaceful life.',
      updateInfo: 'Chapter 150',
    },
    {
      id: 'manga-3',
      title: 'One Piece',
      cover: '/images/poster.png',
      description: 'Follow the adventures of Monkey D. Luffy and his pirate crew.',
      updateInfo: 'Chapter 1100',
    },
    {
      id: 'manga-4',
      title: 'Spy x Family',
      cover: '/images/poster.png',
      description:
        'A spy on an undercover mission gets married and adopts a child as part of his cover.',
      updateInfo: 'Chapter 90',
    },
  ],
  novel: [
    {
      id: 'novel-1',
      title: 'Solo Leveling',
      cover: '/images/poster.png',
      description:
        'In a world where hunters must battle deadly monsters to protect the human race...',
      updateInfo: 'Chapter 270',
    },
    {
      id: 'novel-2',
      title: 'Overlord',
      cover: '/images/poster.png',
      description: 'The final hour of the popular virtual reality game Yggdrasil has come.',
      updateInfo: 'Volume 16',
    },
    {
      id: 'novel-3',
      title: 'Mushoku Tensei',
      cover: '/images/poster.png',
      description:
        'A 34-year-old NEET is killed in a traffic accident and finds himself in a world of magic.',
      updateInfo: 'Volume 26',
    },
    {
      id: 'novel-4',
      title: 'Re:Zero',
      cover: '/images/poster.png',
      description: 'Subaru Natsuki is suddenly summoned to another world.',
      updateInfo: 'Arc 8',
    },
  ],
  movie: [
    {
      id: 'movie-1',
      title: 'Dune: Part Two',
      cover: '/images/poster.png',
      description: 'Paul Atreides unites with Chani and the Fremen while on a warpath of revenge.',
      updateInfo: 'HD',
    },
    {
      id: 'movie-2',
      title: 'Oppenheimer',
      cover: '/images/poster.png',
      description:
        'The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb.',
      updateInfo: '4K',
    },
    {
      id: 'movie-3',
      title: 'Spider-Man: Across the Spider-Verse',
      cover: '/images/poster.png',
      description: 'Miles Morales catapults across the Multiverse.',
      updateInfo: 'HD',
    },
    {
      id: 'movie-4',
      title: 'Interstellar',
      cover: '/images/poster.png',
      description:
        "A team of explorers travel through a wormhole in space in an attempt to ensure humanity's survival.",
      updateInfo: '4K',
    },
  ],
};

export const mockRanking = [
  { id: 'rank-1', title: 'Solo Leveling', views: '2.4M', category: 'Novel' },
  { id: 'rank-2', title: 'Jujutsu Kaisen', views: '2.1M', category: 'Anime' },
  { id: 'rank-3', title: 'One Piece', views: '1.9M', category: 'Manga' },
  { id: 'rank-4', title: 'Dune: Part Two', views: '1.5M', category: 'Movie' },
  { id: 'rank-5', title: "Frieren: Beyond Journey's End", views: '1.2M', category: 'Anime' },
];

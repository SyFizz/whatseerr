export type Language = 'fr' | 'en';

export interface Messages {
  movieAvailable: string;
  seriesAvailable: string;
  mediaAvailable: string;
  requestedBy: (username: string) => string;
  testNotification: string;
}

const fr: Messages = {
  movieAvailable: '🎬 Nouveau film disponible',
  seriesAvailable: '📺 Nouvelle série disponible',
  mediaAvailable: '🍿 Nouveau média disponible',
  requestedBy: (username) => `Demandé par ${username}`,
  testNotification: '✅ Notification de test whatseerr : Seerr est bien connecté à ce groupe.',
};

const en: Messages = {
  movieAvailable: '🎬 New movie available',
  seriesAvailable: '📺 New series available',
  mediaAvailable: '🍿 New media available',
  requestedBy: (username) => `Requested by ${username}`,
  testNotification: '✅ whatseerr test notification: Seerr is connected to this group.',
};

const catalog: Record<Language, Messages> = { fr, en };

export function getMessages(language: Language): Messages {
  return catalog[language];
}

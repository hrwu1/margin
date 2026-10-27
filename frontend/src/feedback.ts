export type FeedbackPreferences = { motion: boolean; vibration: boolean };

export function readFeedbackPreferences(value: string | null): FeedbackPreferences {
  try {
    const saved = JSON.parse(value || '{}');
    return {
      motion: typeof saved?.motion === 'boolean' ? saved.motion : true,
      vibration: typeof saved?.vibration === 'boolean' ? saved.vibration : true,
    };
  } catch { return { motion: true, vibration: true }; }
}

export function effectiveFeedback(preferences: FeedbackPreferences, reduced: boolean, touch: boolean, vibrationApi: boolean) {
  const vibrationAvailable = touch && vibrationApi;
  return {
    motion: preferences.motion && !reduced,
    vibrationAvailable,
    vibration: preferences.vibration && vibrationAvailable && !reduced,
  };
}

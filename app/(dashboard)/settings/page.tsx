'use client';

import { useState } from 'react';
import {
  CoachingStyle,
  ExperienceLevel,
  FeedbackDepth,
  FocusArea,
  DEFAULT_PREFERENCES,
  CoachingPreferences,
} from '@/lib/coaching-config';
import { NotificationSettings } from '@/components/NotificationSettings';

export default function SettingsPage() {
  // Initialize state from localStorage if available (lazy initialization)
  const [preferences, setPreferences] = useState<CoachingPreferences>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('coachingPreferences');
      if (saved) {
        try {
          return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
        } catch {
          // Use defaults if parse fails
        }
      }
    }
    return DEFAULT_PREFERENCES;
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem('coachingPreferences', JSON.stringify(preferences));
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleReset = () => {
    setPreferences(DEFAULT_PREFERENCES);
    localStorage.removeItem('coachingPreferences');
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-900 dark:text-slate-100">Settings</h1>
      
      <div className="space-y-8">
        {/* Notification Settings */}
        <div>
          <h2 className="text-2xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Notifications</h2>
          <p className="text-slate-700 dark:text-slate-300 mb-6">
            Configure when and how you receive study reminders and practice notifications.
          </p>
          <NotificationSettings />
        </div>

        {/* Coaching Settings */}
        <div>
          <h2 className="text-2xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Coaching Preferences</h2>
          <p className="text-slate-700 dark:text-slate-300 mb-6">
            Customize how the AI analyzes your practice sessions and provides feedback.
          </p>

          <div className="space-y-6">
            {/* Coaching Style */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium mb-3 text-slate-900 dark:text-slate-100">
                Coaching Style
              </label>
              <div className="space-y-2">
                {(['encouraging', 'balanced', 'strict'] as CoachingStyle[]).map((style) => (
                  <label key={style} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="style"
                      value={style}
                      checked={preferences.style === style}
                      onChange={(e) => setPreferences({ ...preferences, style: e.target.value as CoachingStyle })}
                      className="w-4 h-4 text-purple-600 dark:text-purple-400"
                    />
                    <div>
                      <span className="font-medium text-slate-900 dark:text-slate-100 capitalize">{style}</span>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {style === 'encouraging' && 'Warm, supportive feedback focusing on growth'}
                        {style === 'balanced' && 'Professional, constructive feedback (recommended)'}
                        {style === 'strict' && 'Direct, rigorous feedback holding to high standards'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Experience Level */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium mb-3 text-slate-900 dark:text-slate-100">
                Experience Level
              </label>
              <select
                value={preferences.experienceLevel}
                onChange={(e) => setPreferences({ ...preferences, experienceLevel: e.target.value as ExperienceLevel })}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              >
                <option value="junior">Junior</option>
                <option value="mid">Mid-Level</option>
                <option value="senior">Senior</option>
                <option value="executive">Executive</option>
              </select>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                This adjusts the expectations and focus areas for your level
              </p>
            </div>

            {/* Feedback Depth */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium mb-3 text-slate-900 dark:text-slate-100">
                Feedback Depth
              </label>
              <div className="space-y-2">
                {(['brief', 'detailed', 'comprehensive'] as FeedbackDepth[]).map((depth) => (
                  <label key={depth} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="depth"
                      value={depth}
                      checked={preferences.feedbackDepth === depth}
                      onChange={(e) => setPreferences({ ...preferences, feedbackDepth: e.target.value as FeedbackDepth })}
                      className="w-4 h-4 text-purple-600 dark:text-purple-400"
                    />
                    <div>
                      <span className="font-medium text-slate-900 dark:text-slate-100 capitalize">{depth}</span>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {depth === 'brief' && 'Quick, high-level feedback'}
                        {depth === 'detailed' && 'Detailed feedback with examples (recommended)'}
                        {depth === 'comprehensive' && 'In-depth feedback with alternatives and explanations'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Focus Areas */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium mb-3 text-slate-900 dark:text-slate-100">
                Focus Areas
              </label>
              <div className="space-y-2">
                {(['all', 'technical', 'communication', 'leadership'] as FocusArea[]).map((area) => (
                  <label key={area} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.focusAreas.includes(area)}
                      onChange={(e) => {
                        if (area === 'all') {
                          setPreferences({ ...preferences, focusAreas: e.target.checked ? ['all'] : [] });
                        } else {
                          const newAreas = e.target.checked
                            ? [...preferences.focusAreas.filter(a => a !== 'all'), area]
                            : preferences.focusAreas.filter(a => a !== area);
                          setPreferences({ ...preferences, focusAreas: newAreas.length > 0 ? newAreas : ['all'] });
                        }
                      }}
                      className="w-4 h-4 text-purple-600 dark:text-purple-400"
                    />
                    <span className="font-medium text-slate-900 dark:text-slate-100 capitalize">{area}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Role */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
                Target Role
              </label>
              <input
                type="text"
                value={preferences.role}
                onChange={(e) => setPreferences({ ...preferences, role: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                placeholder="e.g., Senior Design Engineer / Design Engineering Leader"
              />
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                The role you&apos;re interviewing for (used for context in feedback)
              </p>
            </div>

            {/* Priorities */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
                Priority Areas (comma-separated)
              </label>
              <input
                type="text"
                value={preferences.priorities.join(', ')}
                onChange={(e) => setPreferences({ ...preferences, priorities: e.target.value.split(',').map(p => p.trim()).filter(p => p.length > 0) })}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                placeholder="clarity, impact statements, technical accuracy, resilience, performance"
              />
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                Areas to emphasize in feedback (e.g., clarity, impact statements, technical accuracy)
              </p>
            </div>

            {/* Save Button */}
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                className="px-6 py-3 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors font-semibold"
              >
                {saved ? '✓ Saved' : 'Save Preferences'}
              </button>
              <button
                onClick={handleReset}
                className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                Reset to Defaults
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

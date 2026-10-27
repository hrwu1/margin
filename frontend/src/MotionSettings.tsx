import { useRef, useState } from 'react';
import { Icon } from './ui';
import type { Feedback } from './ui';

export function MotionSettings({ feedback }: { feedback: Feedback }) {
  const preview = useRef<HTMLDivElement>(null);
  const destination = useRef<HTMLSpanElement>(null);
  const [kept, setKept] = useState(false);
  const [vibrationTest, setVibrationTest] = useState('');
  return <div className="settings-content">
    <p className="settings-intro">Small cues that connect your actions to what happens next.</p>
    <div className="feedback-preference">
      <div><label id="motion-label" htmlFor="motion-switch">Fluid motion</label><p id="motion-description">Highlights travel into your collection. Panels ease into place.</p></div>
      <button id="motion-switch" type="button" className="feedback-switch" role="switch" aria-checked={feedback.motion} aria-labelledby="motion-label" aria-describedby={feedback.reduced ? 'motion-description motion-override' : 'motion-description'} disabled={feedback.reduced} onClick={() => feedback.toggle('motion')}><span className="switch-track" aria-hidden="true"><i/></span><span aria-hidden="true">{feedback.motion ? 'On' : 'Off'}</span></button>
    </div>
    {feedback.reduced && <p className="system-preference" id="motion-override"><Icon name="settings"/>Off to match your device’s Reduce Motion setting. Your saved preferences will return when that setting is off.</p>}
    <div className="motion-example" ref={preview}>
      <div className="motion-example-heading"><span>Try a highlight</span><span className="preview-collection" ref={destination}><Icon name="quote"/>Highlights <b>{kept ? '1' : '0'}</b></span></div>
      <button className="preview-passage" onClick={event => {
        setKept(true);
        feedback.transfer(event.currentTarget.getBoundingClientRect(), destination.current, preview.current!);
      }}><span>A detail worth keeping.</span><span className="preview-action"><Icon name={kept ? 'check' : 'plus'}/>{kept ? 'Try again' : 'Highlight'}</span></button>
      <p role="status">{kept ? feedback.motion ? 'Kept in the preview. Try again to replay.' : 'Kept instantly. Motion is off.' : feedback.motion ? 'Tap the passage to see where it goes.' : 'Motion is off. Updates appear instantly.'}</p>
      <small>Preview only · Your comparisons stay unchanged</small>
    </div>
    <div className="feedback-preference vibration-preference">
      <div><label id="vibration-label" htmlFor="vibration-switch">Touch vibration</label><p id="vibration-description">{!feedback.vibrationAvailable ? 'Unavailable on this device or browser. You’ll still see every confirmation.' : feedback.reduced ? 'Off to match your device’s Reduce Motion setting.' : 'A brief tap when you highlight or vote, on supported touch devices.'}</p></div>
      <button id="vibration-switch" type="button" className="feedback-switch" role="switch" aria-checked={feedback.vibration} aria-labelledby="vibration-label" aria-describedby="vibration-description" disabled={!feedback.vibrationAvailable || feedback.reduced} onClick={() => { feedback.toggle('vibration'); setVibrationTest(''); }}><span className="switch-track" aria-hidden="true"><i/></span><span aria-hidden="true">{!feedback.vibrationAvailable ? 'Unavailable' : feedback.vibration ? 'On' : 'Off'}</span></button>
    </div>
    {feedback.vibration && <div className="vibration-test"><button className="quiet-button" onClick={() => { const accepted = feedback.pulse(true); setVibrationTest(accepted === null ? 'Wait a moment, then try again.' : accepted ? 'Test requested. Your device decides whether vibration is available.' : 'Your browser did not allow vibration. Visual feedback stays on.'); }}>Test vibration</button><p role="status">{vibrationTest}</p></div>}
    <p className="settings-storage" role="status">{feedback.storageError ? 'Changed for this visit. Your browser could not save this preference.' : 'Preferences are saved in this browser.'}</p>
  </div>;
}

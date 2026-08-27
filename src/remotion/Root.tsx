import React from 'react';
import { Composition } from 'remotion';
import {
  FLARENT_COMPOSITION_ID,
  FlarentVideo,
  calculateFlarentMetadata,
} from '../compositions/FlarentVideo';
import { defaultScenes } from '../data/defaultScenes';
import { CANVAS } from '../utils/timing';

export const RemotionRoot: React.FC = () => (
  <Composition
    id={FLARENT_COMPOSITION_ID}
    component={FlarentVideo}
    // Placeholders only. calculateMetadata derives the real length from the
    // scene list on every render, so this number is never the source of truth.
    durationInFrames={1}
    fps={CANVAS.fps}
    width={CANVAS.width}
    height={CANVAS.height}
    defaultProps={{ scenes: defaultScenes() }}
    calculateMetadata={calculateFlarentMetadata}
  />
);

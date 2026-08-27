/**
 * Renders one scene: solve the layout, pick the field colour for this frame,
 * lay in the picture, hand off to the registered motion style.
 */

import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { BackgroundName, PaletteName, Scene } from '../types/scene';
import { planScene } from '../utils/plan';
import { DEFAULT_PALETTE, themeFor } from '../utils/typography';
import { backgroundForFrame, styleDefinition } from '../components/motion/registry';
import { SceneImageLayer } from '../components/motion/SceneImageLayer';
import { Outgoing } from '../components/motion/Outgoing';
import { planTransition } from '../utils/transition';
import { resolveStyle } from '../utils/visualStyle';
import { useFontsReady } from '../utils/fonts';

export const SceneRenderer: React.FC<{
  scene: Scene;
  durationInFrames: number;
  palette?: PaletteName;
  fields?: Partial<Record<BackgroundName, string>>;
  /** The scene before this one, and how long it ran — for the seam. */
  previous?: { scene: Scene; durationInFrames: number };
}> = ({
  scene,
  durationInFrames,
  palette = DEFAULT_PALETTE,
  fields,
  previous,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const fontsReady = useFontsReady();

  /**
   * The project's frame, read from Remotion's own config rather than threaded
   * down as a prop. `calculateFlarentMetadata` already derives width/height
   * from `format` for the whole composition, and `useVideoConfig` is that same
   * value wherever it is called in the tree — in the editor's `<Player>` and in
   * the render server's headless render alike — so this is the one place
   * "which frame is active" needs to be asked.
   */
  const canvas = useMemo(() => ({ width, height, fps }), [width, height, fps]);

  // Measurement must happen against the real typeface, so the plan is built
  // only once the faces are live. The field still paints immediately.
  const plan = useMemo(
    () =>
      fontsReady ? planScene(scene, durationInFrames, fps, palette, canvas) : null,
    [scene, durationInFrames, fps, palette, canvas, fontsReady],
  );

  /**
   * The outgoing scene is re-planned here rather than handed over from its own
   * render: same inputs, same layout, so the exit picks up exactly where the
   * previous scene's last frame left off. Measurement is module-cached, so this
   * costs arithmetic rather than a second layout pass.
   */
  const previousPlan = useMemo(
    () =>
      fontsReady && previous
        ? planScene(previous.scene, previous.durationInFrames, fps, palette, canvas)
        : null,
    [fontsReady, previous, fps, palette, canvas],
  );

  const transition = useMemo(() => {
    if (!plan) return undefined;
    // Compare the field the outgoing scene ends on with the one the incoming
    // scene opens on, so styles that flip their own field mid-scene are read
    // correctly rather than by scene setting alone.
    const fieldChanges = previousPlan
      ? backgroundForFrame(
          previousPlan,
          previousPlan.durationInFrames - 1,
          palette,
        ) !== backgroundForFrame(plan, 0, palette)
      : false;
    return planTransition(previousPlan, plan, fps, fieldChanges);
  }, [previousPlan, plan, fps, palette]);

  const background = plan
    ? backgroundForFrame(plan, frame, palette)
    : scene.background;
  const theme = themeFor(background, palette, fields);

  if (!plan) {
    return <AbsoluteFill style={{ backgroundColor: theme.background }} />;
  }

  const picture = scene.image ? (
    <SceneImageLayer
      image={scene.image}
      composition={plan.picture}
      frame={frame}
      fps={fps}
      durationInFrames={durationInFrames}
      theme={theme}
      hardCut={plan.style === 'rapid'}
    />
  ) : null;

  // A free-placed picture may be asked to sit over the type — useful for a
  // collage beat. Everything else stays behind it.
  const inFront = scene.image?.placement === 'free' && scene.image.layer === 'front';

  return (
    <AbsoluteFill style={{ backgroundColor: theme.background }}>
      {inFront ? null : picture}
      <AbsoluteFill style={{ overflow: 'visible' }}>
        {previousPlan && transition ? (
          <Outgoing
            plan={previousPlan}
            transition={transition}
            frame={frame}
            color={theme.ink}
            theme={theme}
            canvas={canvas}
          />
        ) : null}
        {/*
          One style component per element, in reading order — so later elements
          sit in front, and each piece of type animates on its own style, its own
          curve and its own delay. A V2 scene has exactly one element here, which
          is why this is the same render it always was.
        */}
        {plan.elements.map((element) => {
          const { Component } = styleDefinition(element.style);
          return (
            <Component
              key={element.id}
              plan={plan}
              element={element}
              frame={frame}
              fps={fps}
              durationInFrames={durationInFrames}
              color={theme.ink}
              /*
               * Style is resolved *here*, against the field colour for this
               * frame, not in the planner: STACK and RAPID cut the field
               * mid-scene, so an ink-derived colour is a property of the frame.
               * The animation component only forwards it.
               */
              visual={resolveStyle(element.visual, theme)}
              transition={transition}
              canvas={canvas}
            />
          );
        })}
      </AbsoluteFill>
      {inFront ? picture : null}
    </AbsoluteFill>
  );
};

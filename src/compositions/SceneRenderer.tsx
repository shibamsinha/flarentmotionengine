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
import { planObjects } from '../utils/planObjects';
import { ObjectLayer } from '../components/motion/ObjectLayer';

export const SceneRenderer: React.FC<{
  scene: Scene;
  durationInFrames: number;
  palette?: PaletteName;
  fields?: Partial<Record<BackgroundName, string>>;
  /** V8 — explicit ink per field, honoured exactly rather than auto-contrasted. */
  ink?: Partial<Record<BackgroundName, string>>;
  /** V8 — the project accent. Objects fall back to it when they name no fill. */
  accent?: string;
  /** The scene before this one, and how long it ran — for the seam. */
  previous?: { scene: Scene; durationInFrames: number };
}> = ({
  scene,
  durationInFrames,
  palette = DEFAULT_PALETTE,
  fields,
  ink,
  accent,
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

  /**
   * V6 objects. Planned separately from the type and, unlike it, without
   * waiting on `fontsReady` — a rounded rectangle needs no glyph measurement,
   * and holding the graphics back until the faces load would make them appear
   * a frame or two late.
   */
  const objectPlan = useMemo(
    () => planObjects(scene.objects, durationInFrames, fps),
    [scene.objects, durationInFrames, fps],
  );

  const background = plan
    ? backgroundForFrame(plan, frame, palette)
    : scene.background;
  const theme = themeFor(background, palette, fields, ink, accent);

  /**
   * Objects split around the type by `layer`: negative sits behind it, which is
   * how "put the card behind the headline" is said without a layer panel.
   * Sorted already by the planner, so this is a partition, not a re-sort.
   */
  const behindType = objectPlan.objects.filter((o) => o.layer < 0);
  const inFrontOfType = objectPlan.objects.filter((o) => o.layer >= 0);

  if (!plan) {
    /*
     * Type is still measuring. Objects need no font, so they draw anyway —
     * otherwise a scene that is mostly graphics would flash empty while the
     * faces load.
     */
    return (
      <AbsoluteFill style={{ backgroundColor: theme.background }}>
        <ObjectLayer
          plan={objectPlan}
          frame={frame}
          fps={fps}
          canvas={canvas}
          theme={theme}
        />
      </AbsoluteFill>
    );
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
      {behindType.length > 0 ? (
        <ObjectLayer
          plan={{ ...objectPlan, objects: behindType }}
          frame={frame}
          fps={fps}
          canvas={canvas}
          theme={theme}
        />
      ) : null}
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
      {/* V6 objects over the type. Above the free-placed picture too, since a
          cursor or a button is the subject of the frame, not a backdrop. */}
      {inFrontOfType.length > 0 ? (
        <AbsoluteFill style={{ overflow: 'visible' }}>
          <ObjectLayer
            plan={{ ...objectPlan, objects: inFrontOfType }}
            frame={frame}
            fps={fps}
            canvas={canvas}
            theme={theme}
          />
        </AbsoluteFill>
      ) : null}
      {inFront ? picture : null}
    </AbsoluteFill>
  );
};

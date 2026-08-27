/**
 * Visual style controls.
 *
 * Two rules shape this panel. Only the controls that belong to the chosen style
 * are shown — a stroke width next to a gradient is noise. And the previews are
 * drawn with `styleCss`, the same function the renderer uses, so a swatch
 * cannot drift from what will actually export.
 *
 * Used twice: for the scene, and for an element overriding it.
 */

import React from 'react';
import type { PaletteName } from '../../types/scene';
import {
  HOUSE_GRADIENT,
  VISUAL_STYLE_NAMES,
  VISUAL_STYLES,
  resolveStyle,
  styleCss,
  type GradientConfig,
  type VisualStyleConfig,
  type VisualStyleName,
} from '../../utils/visualStyle';
import { FONT_STACK, themeFor } from '../../utils/typography';
import type { BackgroundName } from '../../types/scene';

const PREVIEW_BOX = { width: 92, height: 22, offsetX: 0, offsetY: 0 };

/** A style drawn the way it will render. */
export const StyleSwatch: React.FC<{
  style: VisualStyleName;
  background: BackgroundName;
  palette: PaletteName;
  config?: VisualStyleConfig;
}> = ({ style, background, palette, config }) => {
  const theme = themeFor(background, palette);
  const resolved = resolveStyle({ ...config, type: style }, theme);
  const parts = resolved.type === 'split' ? resolved.parts : [resolved];

  return (
    <span
      className="style-swatch"
      style={{ backgroundColor: theme.background }}
      aria-hidden
    >
      {parts.map((part, index) => (
        <span
          key={index}
          style={{
            ...(styleCss(part, 15, PREVIEW_BOX) as React.CSSProperties),
            fontFamily: FONT_STACK,
            fontWeight: 800,
            fontSize: 15,
            letterSpacing: '-0.03em',
          }}
        >
          {parts.length > 1 ? (index === 0 ? 'CUST' : 'OMERS') : 'CUSTOMERS'}
        </span>
      ))}
    </span>
  );
};

const Color: React.FC<{
  label: string;
  value: string;
  onChange: (next: string) => void;
  onReset?: () => void;
}> = ({ label, value, onChange, onReset }) => (
  <label className="mini-field">
    <span>{label}</span>
    <span className="color-row">
      <input
        type="color"
        className="color-input"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      {onReset ? (
        <button type="button" className="btn tiny" onClick={onReset} title="Back to the field's own ink">
          Auto
        </button>
      ) : null}
    </span>
  </label>
);

export const VisualStyleControls: React.FC<{
  /** What the style is being chosen for — a scene, or one element. */
  scope: 'scene' | 'element';
  style: VisualStyleName | undefined;
  config: VisualStyleConfig | undefined;
  background: BackgroundName;
  palette: PaletteName;
  /** Only for elements: what it falls back to. */
  inherited?: VisualStyleName;
  onChange: (style: VisualStyleName | undefined, config: VisualStyleConfig | undefined) => void;
}> = ({ scope, style, config, background, palette, inherited, onChange }) => {
  const theme = themeFor(background, palette);
  const active = style ?? inherited ?? 'solid';
  const resolved = resolveStyle({ ...config, type: active }, theme);

  const patch = (changes: Partial<VisualStyleConfig>) =>
    onChange(active, { ...config, ...changes, type: active });

  const gradient: GradientConfig = resolved.gradient ?? HOUSE_GRADIENT;

  const setGradientColor = (index: number, value: string) => {
    const colors = [...gradient.colors];
    colors[index] = value;
    patch({ gradient: { ...gradient, colors } });
  };

  return (
    <div className="field">
      <label>{scope === 'scene' ? 'Visual style' : 'Visual style · this element'}</label>

      <div className="style-grid">
        {(scope === 'element'
          ? ([undefined, ...VISUAL_STYLE_NAMES] as (VisualStyleName | undefined)[])
          : VISUAL_STYLE_NAMES
        ).map((name) => {
          const isOn = scope === 'element' ? style === name : style === name || (!style && name === 'solid');
          if (name === undefined) {
            return (
              <button
                key="inherit"
                type="button"
                className={`style-card${isOn ? ' is-on' : ''}`}
                onClick={() => onChange(undefined, undefined)}
              >
                <StyleSwatch
                  style={inherited ?? 'solid'}
                  background={background}
                  palette={palette}
                />
                <span className="style-name">AUTO</span>
              </button>
            );
          }
          return (
            <button
              key={name}
              type="button"
              className={`style-card${isOn ? ' is-on' : ''}`}
              onClick={() => onChange(name, name === active ? config : { type: name })}
              title={VISUAL_STYLES[name].description}
            >
              <StyleSwatch
                style={name}
                background={background}
                palette={palette}
                config={name === active ? config : undefined}
              />
              <span className="style-name">{VISUAL_STYLES[name].label}</span>
            </button>
          );
        })}
      </div>

      <p className="hint">
        {scope === 'element' && !style
          ? `Inherits the scene — ${VISUAL_STYLES[inherited ?? 'solid'].label}.`
          : `${VISUAL_STYLES[active].description} ${VISUAL_STYLES[active].use}`}
      </p>

      {/* Only the controls this style actually has. */}
      {(scope === 'scene' || style) && active === 'solid' ? (
        <div className="field-row">
          <Color
            label="Colour"
            value={resolved.fill ?? theme.ink}
            onChange={(fillColor) => patch({ fillColor })}
            onReset={() => patch({ fillColor: undefined })}
          />
        </div>
      ) : null}

      {(scope === 'scene' || style) && active === 'outline' ? (
        <>
          <div className="field-row">
            <Color
              label="Stroke"
              value={resolved.stroke?.color ?? theme.ink}
              onChange={(strokeColor) => patch({ strokeColor })}
              onReset={() => patch({ strokeColor: undefined })}
            />
            <div className="mini-field">
              <span>Weight · {((resolved.stroke?.width ?? 0.03) * 100).toFixed(1)}%</span>
              <input
                type="range"
                min={0.008}
                max={0.075}
                step={0.002}
                value={resolved.stroke?.width ?? 0.03}
                onChange={(event) =>
                  patch({ strokeWidth: Number(event.target.value) })
                }
              />
            </div>
          </div>
          <div className="field">
            <div className="segmented">
              <button
                type="button"
                className={!resolved.fill ? 'is-on' : ''}
                onClick={() => patch({ fillColor: undefined })}
              >
                Hollow
              </button>
              <button
                type="button"
                className={resolved.fill ? 'is-on' : ''}
                onClick={() => patch({ fillColor: theme.background })}
              >
                Filled
              </button>
            </div>
            <p className="hint">
              Weight is a percentage of the type size, so an oversized word keeps
              a real stroke instead of a hairline.
            </p>
          </div>
        </>
      ) : null}

      {(scope === 'scene' || style) && active === 'gradient' ? (
        <>
          <div className="field-row">
            {gradient.colors.slice(0, 2).map((color, index) => (
              <Color
                key={index}
                label={`Colour ${index + 1}`}
                value={color}
                onChange={(next) => setGradientColor(index, next)}
              />
            ))}
          </div>
          <div className="field-row">
            {gradient.colors.slice(2, 4).map((color, index) => (
              <Color
                key={index + 2}
                label={`Colour ${index + 3}`}
                value={color}
                onChange={(next) => setGradientColor(index + 2, next)}
              />
            ))}
          </div>
          <div className="field">
            <label>Angle · {gradient.angle}°</label>
            <div className="number-row">
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={gradient.angle}
                onChange={(event) =>
                  patch({ gradient: { ...gradient, angle: Number(event.target.value) } })
                }
              />
              <button
                type="button"
                className="btn"
                onClick={() => patch({ gradient: HOUSE_GRADIENT })}
              >
                Reset
              </button>
            </div>
          </div>
        </>
      ) : null}

      {(scope === 'scene' || style) && active === 'split' ? (
        <div className="field">
          <label>Split across</label>
          <div className="segmented">
            {(['auto', 'word', 'letter'] as const).map((unit) => (
              <button
                key={unit}
                type="button"
                className={(config?.splitBy ?? 'auto') === unit ? 'is-on' : ''}
                onClick={() => patch({ splitBy: unit })}
              >
                {unit}
              </button>
            ))}
          </div>
          <p className="hint">
            Two treatments in one piece of type — solid, then the gradient. AUTO
            splits across words, or across the letters of a single word.
          </p>
        </div>
      ) : null}
    </div>
  );
};

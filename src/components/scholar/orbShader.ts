// The voice orb's shader (2026-11-15), in SkSL, Skia's shading language: the shader orb (`VoiceOrbSkia`) compiles it once with
// `Skia.RuntimeEffect.Make` and fills its canvas with it, and the uniforms come from `orbUniforms` (src/utils/orbShape.ts) every
// frame. It draws, from the back: a rose glow that fades out before the canvas's edge, a plum ring leaving the sphere while
// Scholar thinks, then the sphere itself. The sphere's outline is a circle plus four travelling waves (`amp`, `phase`), so it
// changes its shape with the voice; inside it plum deepens to plum-deep toward the edge, two ribbons of light (rose and a
// champagne made of terracotta and glass) turn through a slow liquid warp, and a sheen and a rose rim give it the look of glass.
// Every colour is a brand token's (rose, plum, plum-deep) or made from them; the output is premultiplied, as Skia expects.
// A plain string, so it is read without Skia: the Node checks and the PC preview read it too.

export const ORB_SHADER = `
uniform float2 center;
uniform float radius;
uniform float pixel;
uniform float swell;
uniform float4 amp;
uniform float4 phase;
uniform float2 turn;
uniform float2 warp;
uniform float level;
uniform float alpha;
uniform float glow;
uniform float ring;

const float3 PLUM = float3(0.357, 0.227, 0.369);
const float3 PLUM_DEEP = float3(0.243, 0.153, 0.255);
const float3 PLUM_LIGHT = float3(0.490, 0.350, 0.500);
const float3 ROSE = float3(0.831, 0.647, 0.647);
const float3 CHAMPAGNE = float3(0.878, 0.702, 0.620);

// The outline's radius at an angle, as a share of the swollen radius.
float outline(float theta) {
  return 1.0 + amp.x * sin(2.0 * theta + phase.x) + amp.y * sin(3.0 * theta + phase.y)
    + amp.z * sin(4.0 * theta + phase.z) + amp.w * sin(5.0 * theta + phase.w);
}

// A soft band of light, turned about the sphere's centre by an angle and set off along its length, in the unit sphere's
// coordinates.
float ribbon(float2 q, float angle, float shift, float2 axes) {
  float c = cos(angle);
  float s = sin(angle);
  float2 v = (float2(c * q.x + s * q.y, -s * q.x + c * q.y) - float2(shift, 0.0)) / axes;
  return exp(-dot(v, v));
}

// A soft spot of light at a point of the unit sphere.
float spot(float2 q, float2 at, float2 axes) {
  float2 v = (q - at) / axes;
  return exp(-dot(v, v));
}

float3 screen(float3 base, float3 light) {
  return 1.0 - (1.0 - base) * (1.0 - light);
}

half4 main(float2 p) {
  float2 d = p - center;
  float r = length(d);
  float theta = r < 0.001 ? 0.0 : atan(d.y, d.x);
  float edge = radius * swell * outline(theta);
  float sd = r - edge;

  // Behind the sphere: the rose glow, gone before the canvas's edge, and a ring leaving the sphere.
  float fade = 1.0 - smoothstep(center.x * 0.8, center.x * 0.97, r);
  float g = glow * exp(-max(sd, 0.0) / (radius * (0.3 + 0.12 * level))) * fade;
  float4 back = float4(ROSE * g, g);
  if (ring < 1.0) {
    float ringA = (1.0 - smoothstep(0.6 * pixel, 1.6 * pixel, abs(r - edge * (1.0 + 0.35 * ring)))) * 0.45 * (1.0 - ring);
    back = float4(PLUM * ringA, ringA) + back * (1.0 - ringA);
  }

  // The sphere: plum deepening to plum-deep toward its edge, lighter at the top left.
  float2 q = d / (radius * swell);
  float t = r / edge;
  float3 col = mix(PLUM, PLUM_DEEP, smoothstep(0.1, 0.95, t));
  col = mix(col, PLUM_LIGHT, 0.35 * spot(q, float2(-0.35, -0.4), float2(0.55, 0.55)));
  // A slow liquid warp, livelier with the voice, and the two ribbons of light screened in through it.
  float w = 0.05 + 0.09 * level;
  float2 qw = q + w * float2(sin(3.1 * q.y + warp.x), cos(2.7 * q.x - warp.y));
  float rose = ribbon(qw, 0.49 + turn.x, 0.1, float2(0.62, 0.34) * (1.0 + 0.35 * level));
  float light = ribbon(qw, -0.7 + turn.y, -0.12, float2(0.54, 0.3));
  col = screen(col, ROSE * rose * (0.55 + 0.4 * level));
  col = screen(col, CHAMPAGNE * light * (0.4 + 0.45 * level));
  // The glass: a sheen at the top left and a rose rim along the outline, both brighter with the voice.
  col = screen(col, float3(1.0) * spot(q, float2(-0.3, -0.48), float2(0.36, 0.2)) * (0.3 + 0.2 * level));
  float rimWidth = radius * 0.05;
  float rim = exp(-(sd * sd) / (rimWidth * rimWidth));
  col = screen(col, ROSE * rim * (0.3 + 0.6 * level));

  float a = clamp(0.5 - sd / pixel, 0.0, 1.0) * alpha;
  return half4(float4(col * a, a) + back * (1.0 - a));
}
`;

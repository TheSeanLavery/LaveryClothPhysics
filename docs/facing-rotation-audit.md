# Facing rotation audit (~90° off)

## The one mistake that causes ~90° error

Using **walk root yaw** for anything that is not walking:

```text
walkRoot = atan2(dx, dz) + meshBindYaw   // meshBindYaw ≈ −90°
```

`meshBindYaw` is **not** “where the mesh points.” It is a **walk-only** coupling so stride direction matches WASD. Idle and attack clips rotate the hips differently, so the same formula aims the root ~90° from where you want to look.

**Mesh-aligned root** (idle, attack, spawn, snap):

```text
root.y = facingYaw + wrap(atan2(dx, dz) − measureForwardYaw())
```

## Path audit (current code)

| Path | Uses | ~90° risk |
|------|------|-----------|
| Walk (`moveLength > threshold`) | `walkRootYawFromVelocity` | Correct for walk only |
| Idle look-at (`idle` + opponent) | `rootYawToMatchMeshIntent` | Low |
| Attack (`Space` / `playAttackToward`) | snap before + after clip, `onStateEntered`, per-frame snap | Low (was: pre-clip snap only + lerp) |
| Attack FSM panel button | `playAttackToward` → other fighter | Was: raw `fsm.trigger('attack')` with no snap |
| Spawn / `syncFightersFacing` | `snapFaceToward` | Low |
| `rootYawToMatchMeshIntent` fallback when `measureForwardYaw()` is null | **walk formula** | High if bones missing |
| `stanceYawOffset` in profile | **unused** in controller | ~8°, not 90° |
| Clip files (rokoko audit) | all 0° bucket vs FightingIdle | Not the duel bug |

## Debug arrows

- **Green / blue**: mesh intent (`atan2(dx, dz)` toward opponent or WASD).
- **Orange / pink**: `rig.measureForwardYaw()` (hips / shoulders).

Green ≈ orange → facing is correct. Green correct but orange ~90° off → root still on walk formula or snap happened before attack pose.

Console: `__duelFacingDebug('A')` → `meshAlignErrorDeg` should be near **0°** in idle/attack; can be large while walking (walk root ≠ bone forward by design).

## Long-term

Rotate meshy bind at load, set `meshBindYaw: 0`, drop walk-only −90° hack once stride and bind agree (`npm run audit:mesh-bind`).

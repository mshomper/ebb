"""Retarget Matt's Meshy clips onto the walker's own 20-bone rig (doc 23; approved October 26, 2026),
written as assets/figures/walker-clips.json for src/world/figure/clips.js.

Nothing of Meshy's model is used: only how its bones turn. Each Meshy bone's turn is measured from its
own rest (bind) pose, in the model's frame (D = R_now R_rest^-1), so the two rest poses need not
match. Ours (rest frames all upright, the arms in an A-pose):
  pelvis        spine (the root): the hips, with their bob and sway
  spine, chest  spine.002, spine.003 (spine.001's turn folds in: global turns)
  head          spine.005 (spine.004 folds in)
  upperArm      upper_arm (the shoulder's turn folds in); the A-pose arm is first turned onto
                Meshy's hanging arm (its right arm, mirrored for the left: Meshy's left upper-arm
                joint sits off the arm)
  foreArm, hand forearm, hand, after the same turn onto Meshy's forearm
  thigh, shin, foot   thigh, shin, foot; the toes are dropped
The hat, hat tip, coat skirt and pack are left to the game's springs.

Root travel is stripped (a straight line from the first frame to the last), so every clip plays in
place; the hips' rise and fall is scaled to our legs, and set so a planted foot stands on the ground.
The roll is cut out of Run_Jump_and_Roll after the jump has landed: no run-up and no jump.

Per clip the file holds frames (30 a second) of the pelvis's shift and every driven bone's local
turn, the left foot's landings (so walks and runs blend in step), and the speed it covers on our legs.

Run (Python 3 with numpy), from the repo root:
  python tools/figure-prep/clips.py <Meshy rigged .glb with clips> recipes/world/figure.json assets/figures/walker.glb assets/figures/walker-clips.json
Several Meshy files on the same rig split by ';' (a clip comes from the first that has it); --set fight
writes the fighting clips (C1, October 27, 2026) to their own file.
"""
import json, sys, warnings
import numpy as np
import glb

# Which clips, under which names, and which part of each (seconds). loop: a walk or run cycle.
CLIPS = [
    ('walk', 'Walking', None, True),
    ('casual', 'Casual_Walk', None, True),
    ('creep', 'Thoughtful_Walk', None, True),
    ('jog', 'Run_02', None, True),
    ('run', 'Running', None, True),
    # The roll alone: from landing out of the jump (both feet down, crouched) to standing again.
    ('roll', 'Run_Jump_and_Roll', (1.867, 3.2), False),
    # Kept for the Hollow (the torch in hand).
    ('torchWalk', 'Crouch_Walk_with_Torch', None, True),
    ('torchLeft', 'Crouch_Walk_Left_with_Torch_inplace', None, True),
    ('torchRight', 'Crouch_Walk_Right_with_Torch_inplace', None, True),
    # On the island now (C3, October 27, 2026; the additional animations file): Lift with the shovel,
    # gathering and picking up, and going down to kneel. Played as one-shots (clips.js shots).
    ('pull', 'Pull_Radish', None, False),
    ('collect', 'Collect_Object', None, False),
    ('squat', 'air_squat', None, False),
]
# The fighting clips (C1, October 27, 2026), a set of their own (--set fight) so the game's walk load
# doesn't grow: named by the pose each serves (recipes/world/fight-clips.json), for the move arena.
FIGHT = [
    ('swingDouble', 'Double_Combo_Attack', None, False),
    ('swingTriple', 'Triple_Combo_Attack', None, False),
    ('swingCombo', 'Weapon_Combo_2', None, False),
    ('swingThrust', 'Thrust_Slash', None, False),
    ('plantSlam', 'Charged_Ground_Slam', None, False),
    ('brace', 'Block10', None, False),
    ('feint', 'Sword_Parry_Backward_4', None, False),
    ('sidestep', 'Stand_Dodge', None, False),
    ('hit', 'Hit_Reaction', None, False),
    ('raiseCast', 'mage_soell_cast_7', None, False),
    ('backAway', 'Cautious_Crouch_Walk_Backward', None, True),
    # Matt's Text-to-Animation pair (The+Walker_Toss_Point+Cast.glb), unnamed in the file.
    ('throwToss', '_01a17e2a_2988_746c_b10a_07f3f5e55122', (0.1, 1.85), False),
    ('pointCast', '_01a17e29_1736_762f_bbb2_2d60d27c6ba7', (0.15, 2.3), False),
    # Raise the lantern (Matt, October 27, 2026): the same point unmirrored, so the left (lantern)
    # hand rises; played as a held layer on the left arm only (fight-clips.json raiseLantern).
    ('raiseLantern', '_01a17e29_1736_762f_bbb2_2d60d27c6ba7', (0.15, 2.3), False),
]
SETS = {'main': CLIPS, 'fight': FIGHT}
# Cheap cleaning for Matt's Text-to-Animation pair (passable, not perfect): smooth, passes of a
# 1-2-1 smoothing over the frames against jitter; mirror, left for right (the point is Meshy's left
# hand, the lantern's).
# unturn: the hips' turn about the vertical taken out (the point turns the body nearly round).
CLEAN = {'throwToss': {'smooth': 2}, 'pointCast': {'smooth': 2, 'mirror': True, 'unturn': True}, 'raiseLantern': {'smooth': 2, 'unturn': True}}
BACKWARD = {'backAway'}
DRIVEN = ['pelvis', 'spine', 'chest', 'head', 'upperArm.l', 'foreArm.l', 'hand.l', 'upperArm.r', 'foreArm.r', 'hand.r',
          'thigh.l', 'shin.l', 'foot.l', 'thigh.r', 'shin.r', 'foot.r']
SOURCE = {'pelvis': 'spine', 'spine': 'spine.002', 'chest': 'spine.003', 'head': 'spine.005',
          'upperArm.l': 'upper_arm.L', 'foreArm.l': 'forearm.L', 'hand.l': 'hand.L',
          'upperArm.r': 'upper_arm.R', 'foreArm.r': 'forearm.R', 'hand.r': 'hand.R',
          'thigh.l': 'thigh.L', 'shin.l': 'shin.L', 'foot.l': 'foot.L',
          'thigh.r': 'thigh.R', 'shin.r': 'shin.R', 'foot.r': 'foot.R'}
# The additional animations file (October 27, 2026) names the same Meshy joints the Mixamo way: read
# under the first file's names.
MIXAMO = {'Hips': 'spine', 'Spine': 'spine.001', 'Spine1': 'spine.002', 'Spine2': 'spine.003', 'Neck': 'spine.004', 'Head': 'spine.005'}
for _s, _S in (('Left', 'L'), ('Right', 'R')):
    MIXAMO.update({_s + 'Shoulder': 'shoulder.' + _S, _s + 'Arm': 'upper_arm.' + _S, _s + 'ForeArm': 'forearm.' + _S, _s + 'Hand': 'hand.' + _S,
                   _s + 'UpLeg': 'thigh.' + _S, _s + 'Leg': 'shin.' + _S, _s + 'Foot': 'foot.' + _S, _s + 'ToeBase': 'toe.' + _S})
FPS = 30
ANKLE_UP = 0.02      # a foot is down while its ankle is within this of its standing height (m)


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def matq(m):
    """A rotation matrix as a quaternion (x, y, z, w), w >= 0."""
    t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1) * 2
        q = [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, s / 4]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        q = [s / 4, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        q = [(m[0, 1] + m[1, 0]) / s, s / 4, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    else:
        s = np.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        q = [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, s / 4, (m[1, 0] - m[0, 1]) / s]
    q = np.array(q) / np.linalg.norm(q)
    return q if q[3] >= 0 else -q


def from_to(a, b):
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), a @ b
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K / (1 + c)


class Meshy:
    """The rigged Meshy file: its bind pose and its clips, sampled as global transforms."""

    def __init__(self, path):
        self.j, self.b = glb.read(path)
        j = self.j
        self.names = [MIXAMO.get((n.get('name') or '').replace('mixamorig:', ''), n.get('name')) for n in j['nodes']]
        self.parent = {c: i for i, n in enumerate(j['nodes']) for c in n.get('children', [])}
        sk = j['skins'][0]
        ibm = glb.accessor(j, self.b, sk['inverseBindMatrices']).reshape(-1, 4, 4)
        self.rest = {}
        for k, ji in enumerate(sk['joints']):
            M = np.linalg.inv(ibm[k].T)          # glTF matrices are column-major
            self.rest[self.names[ji]] = (M[:3, :3], M[:3, 3])
        self.anims = {a['name']: a for a in j['animations']}

    def frames(self, name, span):
        """Global (rotation, position) of every node, at FPS through the clip (or the span)."""
        a, j, b = self.anims[name], self.j, self.b
        ch = []
        for c in a['channels']:
            s = a['samplers'][c['sampler']]
            ch.append((c['target']['node'], c['target']['path'], glb.accessor(j, b, s['input']), glb.accessor(j, b, s['output']).astype(np.float64)))
        end = max(c[2][-1] for c in ch)
        t0, t1 = span if span else (0.0, float(end))
        times = np.arange(t0, t1 + 1e-6, 1 / FPS)
        base = {i: [np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float),
                    np.array(n.get('scale', [1, 1, 1]), float)] for i, n in enumerate(j['nodes'])}
        out = []
        for t in times:
            loc = {i: [v.copy() for v in base[i]] for i in base}
            for node, path, ti, vo in ch:
                k = int(np.clip(np.searchsorted(ti, t) - 1, 0, len(ti) - 2))
                f = float(np.clip((t - ti[k]) / max(ti[k + 1] - ti[k], 1e-9), 0, 1))
                v = vo[k] * (1 - f) + vo[k + 1] * f
                if path == 'rotation':
                    v /= np.linalg.norm(v)
                loc[node][{'translation': 0, 'rotation': 1, 'scale': 2}[path]] = v
            G = {}

            def g(i):
                if i not in G:
                    T, Q, S = loc[i]
                    M = np.eye(4)
                    M[:3, :3] = qmat(Q) * S
                    M[:3, 3] = T
                    G[i] = g(self.parent[i]) @ M if i in self.parent else M
                return G[i]
            out.append({self.names[i]: (g(i)[:3, :3], g(i)[:3, 3]) for i in range(len(self.names))})
        return times - t0, out


def our_skeleton(recipe, model):
    R = json.load(open(recipe))
    j, _ = glb.read(model)
    arms = j['extras']['arms']
    bones = []
    names = [b['name'] for b in R['bones']]
    for b in R['bones']:
        if 'arm' in b:
            a = arms[b['arm']]
            pivot = np.array(a['shoulder']) + np.array(a['axis']) * b['t']
        else:
            pivot = np.array(b['pivot'], float)
        bones.append(dict(name=b['name'], parent=names.index(b['parent']) if b['parent'] else -1, pivot=pivot))
    return bones, arms


def foot_tip(model, ankle):
    """Where our boot's ball is, from the ankle (the left boot, rest model m): the same share of the
    way to the toe tip as Meshy's toe joint, just over the sole."""
    j, b = glb.read(model)
    parts = j['extras']['parts']
    for m in j['meshes']:
        if m['name'] != 'body':
            continue
        a = m['primitives'][0]['attributes']
        P = glb.accessor(j, b, a['POSITION']).astype(float)
        L = glb.accessor(j, b, a['_PART'])
        boot = P[(L == parts['leg.l']) & (P[:, 1] < 0.05)]
        tip = boot[np.argmax(boot[:, 2])]
        return np.array([ankle[0], 0.035, ankle[2] + 0.6 * (tip[2] - ankle[2])])
    raise ValueError('no body mesh')


def fk(bones, local, shift):
    """Our bones' world rotation and where each pivot is, from local turns about rest pivots."""
    Rg, Pg = [None] * len(bones), [None] * len(bones)
    for i, b in enumerate(bones):
        q = local.get(b['name'], np.eye(3))
        if b['parent'] < 0:
            Rg[i] = q
            Pg[i] = b['pivot'] + shift
        else:
            p = b['parent']
            Rg[i] = Rg[p] @ q
            Pg[i] = Pg[p] + Rg[p] @ (b['pivot'] - bones[p]['pivot'])
    return Rg, Pg


MIRROR = np.diag([-1.0, 1.0, 1.0])


def mirror(g):
    """A frame's (or the rest pose's) joints mirrored left for right: the point clip points with
    Meshy's left hand, the lantern hand, and every move that needs a hand uses the weapon hand."""
    sw = lambda n: n[:-2] + ('.R' if n.endswith('.L') else '.L') if n and n[-2:] in ('.L', '.R') else n
    return {n: (MIRROR @ g[sw(n)][0] @ MIRROR, MIRROR @ g[sw(n)][1]) for n in g if sw(n) in g}


def unturned(q):
    """The hips' turns with their twist about the vertical taken out (x, y, z, w rows): the body
    keeps facing ahead, its lean and sway kept."""
    t = np.zeros_like(q)
    t[:, 1], t[:, 3] = q[:, 1], q[:, 3]
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
    # conj(t) * q
    x, y, z, w = -t[:, 0], -t[:, 1], -t[:, 2], t[:, 3]
    a, b, c, d = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    out = np.stack([w * a + x * d + y * c - z * b, w * b - x * c + y * d + z * a, w * c + x * b - y * a + z * d, w * d - x * a - y * b - z * c], 1)
    return out * np.where(out[:, 3:] < 0, -1, 1)


def smooth_frames(shifts, quats):
    """One pass of a 1-2-1 smoothing over the frames (the ends kept), for a jittery clip: the turns
    each brought to the same side as the frame's own before they are averaged."""
    s, q = shifts.copy(), quats.copy()
    for i in range(1, len(s) - 1):
        s[i] = (shifts[i - 1] + 2 * shifts[i] + shifts[i + 1]) / 4
        a, b, c = quats[i - 1], quats[i], quats[i + 1]
        a = a * np.sign(np.sum(a * b, axis=1, keepdims=True) + 1e-12)
        c = c * np.sign(np.sum(c * b, axis=1, keepdims=True) + 1e-12)
        m = a + 2 * b + c
        q[i] = m / np.linalg.norm(m, axis=1, keepdims=True)
    return s, q


def main(src, recipe, model, out, which='main'):
    # One or more Meshy files (split by ';'), the same rig; a clip comes from the first that has it,
    # read against that file's own rest pose.
    Ms = [Meshy(p) for p in src.split(';')]
    M = Ms[0]
    bones, arms = our_skeleton(recipe, model)
    I = {b['name']: i for i, b in enumerate(bones)}
    piv = lambda n: bones[I[n]]['pivot']
    mr = lambda n: M.rest[n][1]
    # Limbs follow Meshy's bones by direction: in its bind pose the knees are bent about 60 degrees
    # and the left shoulder joint sits behind the arm, but in the clips its joints move as a person's
    # do. So each of our limb bones is first turned from its own rest direction onto Meshy's, then
    # turned as Meshy's turns: it then points where Meshy's bone points, frame by frame.
    toe = foot_tip(model, piv('foot.l'))
    CORR = {}
    for s, S in (('l', 'L'), ('r', 'R')):
        axis = np.array(arms['arm.' + s]['axis'])
        CORR['upperArm.' + s] = from_to(axis, mr('forearm.' + S) - mr('upper_arm.' + S))
        CORR['foreArm.' + s] = CORR['hand.' + s] = from_to(axis, mr('hand.' + S) - mr('forearm.' + S))
        CORR['thigh.' + s] = from_to(piv('shin.' + s) - piv('thigh.' + s), mr('shin.' + S) - mr('thigh.' + S))
        CORR['shin.' + s] = from_to(piv('foot.' + s) - piv('shin.' + s), mr('foot.' + S) - mr('shin.' + S))
        CORR['foot.' + s] = from_to(toe - piv('foot.l'), mr('toe.' + S) - mr('foot.' + S))
    # Hip height over the ankle: our straight leg against Meshy's (thigh and shin joint to joint).
    leg_ours = sum(np.linalg.norm(bones[I[b]]['pivot'] - bones[I[a]]['pivot']) for a, b in (('thigh.l', 'shin.l'), ('shin.l', 'foot.l')))
    leg_meshy = sum(np.linalg.norm(M.rest[b][1] - M.rest[a][1]) for a, b in (('thigh.L', 'shin.L'), ('shin.L', 'foot.L')))
    k = leg_ours / leg_meshy
    ankle_rest = bones[I['foot.l']]['pivot'][1]
    root_rest = M.rest['spine'][1]

    result = dict(version=1, fps=FPS, bones=DRIVEN, legScale=round(float(k), 4), clips={})
    report = {}
    for name, src_name, span, loop in SETS[which]:
        Mc = next(m for m in Ms if src_name in m.anims)
        times, F = Mc.frames(src_name, span)
        rest = Mc.rest
        cl = CLEAN.get(name, {})
        if cl.get('mirror'):
            F, rest = [mirror(f) for f in F], mirror(Mc.rest)
        n = len(F)
        root = np.array([f['spine'][1] for f in F])
        drift = root[-1] - root[0]
        rows, ankles = [], []
        for fi, f in enumerate(F):
            Q = {}
            for ours in DRIVEN:
                Rr = rest[SOURCE[ours]][0]
                D = f[SOURCE[ours]][0] @ Rr.T
                # Scale (Meshy keeps it at one) is taken out before the turn is read.
                U, _, Vt = np.linalg.svd(D)
                D = U @ Vt
                Q[ours] = D @ CORR.get(ours, np.eye(3))
            local = {}
            for ours in DRIVEN:
                p = bones[I[ours]]['parent']
                local[ours] = Q[ours] if p < 0 else Q[bones[p]['name']].T @ Q[ours]
            # Undriven bones (hat, skirt, pack) follow their parents.
            u = fi / max(n - 1, 1)
            # Travel stripped along the ground (x, z); the rise and fall kept.
            shift = (root[fi] - root[0] - drift * u) * k
            shift[1] = (root[fi][1] - root_rest[1]) * k
            _, Pg = fk(bones, local, shift)
            ankles.append([Pg[I['foot.l']], Pg[I['foot.r']]])
            rows.append((shift, [local[b] for b in DRIVEN]))
        ankles = np.array(ankles)          # n, 2, 3
        # Stand the planted foot on the ground: a lift for the whole clip.
        low = ankles[:, :, 1].min(1)
        lift = ankle_rest - (low[0] if not loop else np.percentile(low, 20))
        ankles[:, :, 1] += lift
        dt = 1 / FPS
        clip = dict(frames=n, dur=round(float(times[-1]), 4), loop=loop)
        if loop:
            # The last frame repeats the first: leave it out of the reading.
            y, z = ankles[:-1, :, 1], ankles[:-1, :, 2]
            down = y < ankle_rest + ANKLE_UP
            vz = (np.roll(z, -1, 0) - np.roll(z, 1, 0)) / (2 * dt)
            # A walk backward (backAway): its planted foot slides forward; read it as the same walk.
            if name in BACKWARD:
                vz = -vz
            speed = float(np.median(-vz[down]))

            def lands(f):
                # Where the foot comes down after it was well up (a little hysteresis), round the loop.
                up, out = False, []
                for i in list(range(len(y))) * 2:
                    if y[i, f] > ankle_rest + 2 * ANKLE_UP:
                        up = True
                    elif up and down[i, f]:
                        up = False
                        out.append(round(float(times[i]), 4))
                return sorted(set(out))
            ll, lr = lands(0), lands(1)
            # How far the body has gone at each frame: as fast as the planted foot slides back (the
            # lower one: the other may be rolling up onto its toes; in the air: as fast as the last
            # frame). Steps of uneven length or pace then still keep the feet planted.
            lower = np.argmin(y, axis=1)
            at = np.arange(len(y))
            step_v = np.where(down[at, lower], -vz[at, lower], np.nan)
            for i in range(len(step_v)):
                if not np.isfinite(step_v[i]):
                    step_v[i] = step_v[i - 1] if i and np.isfinite(step_v[i - 1]) else speed
            step_v = np.maximum(step_v, 0)
            track = np.concatenate([[0], np.cumsum((step_v + np.roll(step_v, -1)) / 2 * dt)])
            clip.update(speed=round(float(track[-1] / times[-1]), 4), cycleM=round(float(track[-1]) / max(1, len(ll)), 4),
                        landsL=ll or [0.0], landsR=lr or [round(0.5 * float(times[-1]), 4)],
                        track=[round(float(d), 4) for d in track])
        shifts = np.array([s + [0, lift, 0] for s, _ in rows])
        quats = np.array([[matq(m) for m in qs] for _, qs in rows])     # n, bones, 4
        if cl.get('unturn'):
            quats[:, 0] = unturned(quats[:, 0])
        for _ in range(cl.get('smooth', 0)):
            shifts, quats = smooth_frames(shifts, quats)
        data = []
        for fi in range(n):
            data += [round(float(v), 4) for v in shifts[fi]]
            for q in quats[fi]:
                data += [round(float(v), 4) for v in q]
        clip['data'] = data
        result['clips'][name] = clip
        report[name] = {kk: v for kk, v in clip.items() if kk != 'data'}
    js = json.dumps(result, separators=(',', ':'))
    open(out, 'w').write(js)
    print(json.dumps(dict(out=out, bytes=len(js), legScale=k, clips=report), indent=1))


if __name__ == '__main__':
    a = sys.argv[1:]
    which = a[a.index('--set') + 1] if '--set' in a else 'main'
    main(*[v for i, v in enumerate(a) if v != '--set' and (i == 0 or a[i - 1] != '--set')][:4], which=which)

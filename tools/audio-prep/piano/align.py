import numpy as np
MAXLAG = 64   # samples at 44.1 kHz (1.45 ms): about 50 cm of mic spacing

def best_lag(x, sr, maxlag=MAXLAG):
    """Lag (samples) of the right channel against the left that makes them most alike over the
    first 300 ms after the onset; positive means the right channel is late."""
    a = np.abs(x).max(1); on = int(np.argmax(a > a.max() * 10 ** (-2.5)))
    n = int(0.3 * sr)
    A = x[on:on + n, 0]; B = x[on:on + n, 1]; n = min(len(A), len(B))
    best, bk = -np.inf, 0
    for k in range(-maxlag, maxlag + 1):
        if k >= 0: c = np.dot(A[:n - k], B[k:n])
        else: c = np.dot(A[-k:n], B[:n + k])
        if c > best: best, bk = c, k
    return bk

def fold(x, sr):
    """Mono from a spaced pair without the comb cancellation of a plain average: the right channel
    is moved by the lag that lines it up with the left, then the two are averaged."""
    if x.shape[1] < 2: return x[:, :1].copy(), 0
    k = best_lag(x, sr)
    R = np.zeros_like(x[:, 1])
    if k >= 0: R[:len(R) - k] = x[k:, 1]
    else: R[-k:] = x[:len(R) + k, 1]
    return ((x[:, 0] + R) / 2)[:, None], k

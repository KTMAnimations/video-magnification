from api.services.stbvmm import STBVMMService


def test_stbvmm_transform_downscale_preserves_aspect_ratio():
    svc = STBVMMService()
    t = svc._compute_transform(width=640, height=352, max_side=192)

    assert t.resized_w == 192
    assert t.resized_h == 106
    assert t.proc_w == 192
    assert t.proc_h == 128
    assert t.pad_left == 0
    assert t.pad_top == 11


def test_stbvmm_transform_high_detail_avoids_downscale_and_pads():
    svc = STBVMMService()
    t = svc._compute_transform(width=640, height=352, max_side=640)

    assert t.resized_w == 640
    assert t.resized_h == 352
    assert t.proc_w == 640
    assert t.proc_h == 384
    assert t.pad_left == 0
    assert t.pad_top == 16

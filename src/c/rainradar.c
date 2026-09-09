#include <pebble.h>
#include <stdio.h>

#define SLOT_COUNT 9
#define NOW_INDEX 4
#define RADAR_PX 200
#define FOOTER_PX 28
#define LOAD_NEED 10

static const int16_t SLOT_OFFSETS[SLOT_COUNT] = {
  -60, -45, -30, -15, 0, 15, 30, 45, 60
};

typedef enum {
  VIEW_STARTING,
  VIEW_AWAITING,
  VIEW_READY,
  VIEW_GAP,
  VIEW_FAILED
} ViewerTag;

static Window *s_window;
static BitmapLayer *s_frame_layer;
static Layer *s_cross_layer;
static TextLayer *s_footer;
static Layer *s_loading;
static bool s_loading_up = true;
static int s_load_have;
static GBitmap *s_frame_bitmap;
static uint8_t *s_img_data;
static int s_img_size;
static uint8_t *s_slot_png[SLOT_COUNT];
static int s_slot_len[SLOT_COUNT];
static time_t s_slot_time[SLOT_COUNT];
static bool s_recv_map;
static uint32_t s_request_id;
static uint32_t s_recv_id;
static int s_cursor = NOW_INDEX;
static ViewerTag s_view = VIEW_STARTING;
static bool s_js_ready;
static char s_footer_buf[32];
static time_t s_frame_time;
static time_t s_origin;

static void set_footer(const char *text) {
  text_layer_set_text(s_footer, text);
}

static void hide_loading(void) {
  if (!s_loading_up) {
    return;
  }
  s_loading_up = false;
  layer_set_hidden(s_loading, true);
}

static void bump_load(void) {
  if (s_load_have >= LOAD_NEED) {
    return;
  }
  s_load_have++;
  if (s_loading && s_loading_up) {
    layer_mark_dirty(s_loading);
  }
  if (s_load_have >= LOAD_NEED) {
    hide_loading();
  }
}

static void loading_update(Layer *layer, GContext *ctx) {
  int fill;
  (void)layer;
  graphics_context_set_fill_color(ctx, GColorWhite);
  graphics_fill_rect(ctx, layer_get_bounds(layer), 4, GCornersAll);
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_draw_round_rect(ctx, layer_get_bounds(layer), 4);
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(
    ctx,
    "loading images",
    fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
    GRect(8, 8, 164, 24),
    GTextOverflowModeTrailingEllipsis,
    GTextAlignmentCenter,
    NULL
  );
  graphics_draw_text(
    ctx,
    "please wait",
    fonts_get_system_font(FONT_KEY_GOTHIC_14),
    GRect(8, 32, 164, 20),
    GTextOverflowModeTrailingEllipsis,
    GTextAlignmentCenter,
    NULL
  );
  graphics_draw_rect(ctx, GRect(14, 58, 152, 14));
  fill = (150 * s_load_have) / LOAD_NEED;
  if (fill > 0) {
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(15, 59, fill, 12), 0, GCornerNone);
  }
}

static void format_slot_footer(time_t when, const char *mark) {
  struct tm *tm = localtime(&when);
  int off = SLOT_OFFSETS[s_cursor];
  if (off > 0) {
    snprintf(s_footer_buf, sizeof(s_footer_buf), "%02d:%02d  +%dm%s", tm->tm_hour, tm->tm_min, off, mark);
  } else if (off < 0) {
    snprintf(s_footer_buf, sizeof(s_footer_buf), "%02d:%02d  %dm%s", tm->tm_hour, tm->tm_min, off, mark);
  } else {
    snprintf(s_footer_buf, sizeof(s_footer_buf), "%02d:%02d  now%s", tm->tm_hour, tm->tm_min, mark);
  }
  set_footer(s_footer_buf);
}

static void format_ready_footer(void) {
  format_slot_footer(s_frame_time, "");
}

static void free_recv(void) {
  if (s_img_data) {
    free(s_img_data);
    s_img_data = NULL;
  }
  s_img_size = 0;
}

static void drop_frame(void) {
  bitmap_layer_set_bitmap(s_frame_layer, NULL);
  if (s_frame_bitmap) {
    gbitmap_destroy(s_frame_bitmap);
    s_frame_bitmap = NULL;
  }
}

static bool show_slot(int slot) {
  GBitmap *next;
  GRect b;
  if (slot < 0 || slot >= SLOT_COUNT || !s_slot_png[slot]) {
    return false;
  }
  drop_frame();
  next = gbitmap_create_from_png_data(s_slot_png[slot], (size_t)s_slot_len[slot]);
  if (!next) {
    return false;
  }
  b = gbitmap_get_bounds(next);
  if (b.size.w <= 0 || b.size.h <= 0) {
    gbitmap_destroy(next);
    return false;
  }
  bitmap_layer_set_bitmap(s_frame_layer, next);
  s_frame_bitmap = next;
  s_frame_time = s_slot_time[slot];
  s_view = VIEW_READY;
  format_ready_footer();
  return true;
}

static void request_slot(void) {
  if (!s_js_ready) {
    return;
  }
  s_request_id++;
  s_view = VIEW_AWAITING;
  if (s_origin) {
    format_slot_footer(s_origin + SLOT_OFFSETS[s_cursor] * 60, "");
  }
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_SlotWanted, s_cursor);
  dict_write_uint32(iter, MESSAGE_KEY_RequestId, s_request_id);
  dict_write_int32(iter, MESSAGE_KEY_Slot, s_cursor);
  app_message_outbox_send();
}

static void go_cursor(int next) {
  s_cursor = next;
  if (!show_slot(s_cursor)) {
    request_slot();
  }
}

static void step_cursor(int dir) {
  int next = s_cursor + dir;
  if (next < 0) {
    next = 0;
  }
  if (next >= SLOT_COUNT) {
    next = SLOT_COUNT - 1;
  }
  if (next == s_cursor) {
    return;
  }
  go_cursor(next);
}

static void up_click(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_loading_up) {
    hide_loading();
    return;
  }
  step_cursor(-1);
}

static void down_click(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_loading_up) {
    hide_loading();
    return;
  }
  step_cursor(1);
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_loading_up) {
    hide_loading();
    return;
  }
  if (s_cursor == NOW_INDEX && s_view == VIEW_READY) {
    show_slot(NOW_INDEX);
    return;
  }
  go_cursor(NOW_INDEX);
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

static int slot_from(DictionaryIterator *iter) {
  Tuple *slot_t = dict_find(iter, MESSAGE_KEY_Slot);
  int slot = slot_t ? slot_t->value->int32 : s_cursor;
  if (slot < 0 || slot >= SLOT_COUNT) {
    return s_cursor;
  }
  return slot;
}

static bool accept_rid(uint32_t rid) {
  return rid == 0 || rid == s_request_id;
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  (void)context;
  Tuple *ready = dict_find(iter, MESSAGE_KEY_JSReady);
  if (ready) {
    s_js_ready = true;
    set_footer("radar");
    request_slot();
    return;
  }

  Tuple *status = dict_find(iter, MESSAGE_KEY_Status);
  if (status) {
    int32_t code = status->value->int32;
    int slot = slot_from(iter);
    if (code == 1) {
      s_view = VIEW_FAILED;
      set_footer("no GPS");
    } else if (code == 2) {
      s_view = VIEW_FAILED;
      set_footer("no radar");
    } else if (code == 3) {
      bump_load();
      if (slot == s_cursor && !s_slot_png[s_cursor]) {
        s_view = VIEW_GAP;
        snprintf(s_footer_buf, sizeof(s_footer_buf), "no data  %+dm", SLOT_OFFSETS[s_cursor]);
        set_footer(s_footer_buf);
      }
    }
  }

  Tuple *origin = dict_find(iter, MESSAGE_KEY_Origin);
  if (origin) {
    s_origin = (time_t)origin->value->uint32;
    if (s_view == VIEW_AWAITING) {
      format_slot_footer(s_origin + SLOT_OFFSETS[s_cursor] * 60, "");
    }
  }

  Tuple *req = dict_find(iter, MESSAGE_KEY_RequestId);
  uint32_t rid = req ? req->value->uint32 : 0;

  Tuple *len = dict_find(iter, MESSAGE_KEY_DataLength);
  if (len) {
    if (!accept_rid(rid)) {
      return;
    }
    s_recv_id = rid;
    s_recv_map = dict_find(iter, MESSAGE_KEY_IsMap) != NULL;
    free_recv();
    s_img_size = len->value->int32;
    if (s_img_size <= 0 || s_img_size > 40000) {
      return;
    }
    s_img_data = malloc((size_t)s_img_size);
    return;
  }

  Tuple *chunk = dict_find(iter, MESSAGE_KEY_DataChunk);
  if (chunk) {
    if (!accept_rid(s_recv_id) || !s_img_data) {
      return;
    }
    Tuple *index_t = dict_find(iter, MESSAGE_KEY_Index);
    Tuple *chunk_size_t = dict_find(iter, MESSAGE_KEY_ChunkSize);
    if (!index_t || !chunk_size_t) {
      return;
    }
    int index = index_t->value->int32;
    int nbytes = chunk_size_t->value->int32;
    if (index < 0 || nbytes < 0 || index + nbytes > s_img_size) {
      return;
    }
    memcpy(s_img_data + index, chunk->value->data, (size_t)nbytes);
    return;
  }

  Tuple *done = dict_find(iter, MESSAGE_KEY_Complete);
  if (done) {
    if (!accept_rid(s_recv_id) || !s_img_data) {
      return;
    }
    if (s_recv_map || dict_find(iter, MESSAGE_KEY_IsMap)) {
      GBitmap *map;
      int nbytes = s_img_size;
      drop_frame();
      map = gbitmap_create_from_png_data(s_img_data, (size_t)nbytes);
      free_recv();
      s_recv_map = false;
      if (map) {
        GRect b = gbitmap_get_bounds(map);
        if (b.size.w > 0) {
          bitmap_layer_set_bitmap(s_frame_layer, map);
          s_frame_bitmap = map;
        } else {
          gbitmap_destroy(map);
        }
      }
      bump_load();
      return;
    }
    int slot = slot_from(iter);
    Tuple *ft = dict_find(iter, MESSAGE_KEY_FrameTime);
    if (ft) {
      s_slot_time[slot] = (time_t)ft->value->uint32;
    }
    if (s_slot_png[slot] && s_slot_png[slot] != s_img_data) {
      free(s_slot_png[slot]);
    }
    s_slot_png[slot] = s_img_data;
    s_slot_len[slot] = s_img_size;
    s_img_data = NULL;
    s_img_size = 0;
    if (slot == s_cursor) {
      show_slot(slot);
    }
    bump_load();
  }
}

static void cross_update(Layer *layer, GContext *ctx) {
  (void)layer;
  graphics_context_set_stroke_color(ctx, GColorBlack);
  graphics_draw_line(ctx, GPoint(94, 100), GPoint(106, 100));
  graphics_draw_line(ctx, GPoint(100, 94), GPoint(100, 106));
  graphics_context_set_stroke_color(ctx, GColorRed);
  graphics_draw_line(ctx, GPoint(96, 100), GPoint(104, 100));
  graphics_draw_line(ctx, GPoint(100, 96), GPoint(100, 104));
}

static void window_load(Window *window) {
  (void)window;
  Layer *root = window_get_root_layer(window);
  window_set_background_color(window, GColorLightGray);

  s_frame_layer = bitmap_layer_create(GRect(0, 0, RADAR_PX, RADAR_PX));
  bitmap_layer_set_background_color(s_frame_layer, GColorLightGray);
  layer_add_child(root, bitmap_layer_get_layer(s_frame_layer));

  s_cross_layer = layer_create(GRect(0, 0, RADAR_PX, RADAR_PX));
  layer_set_update_proc(s_cross_layer, cross_update);
  layer_add_child(root, s_cross_layer);

  s_footer = text_layer_create(GRect(0, RADAR_PX, RADAR_PX, FOOTER_PX));
  text_layer_set_background_color(s_footer, GColorBlack);
  text_layer_set_text_color(s_footer, GColorWhite);
  text_layer_set_font(s_footer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_footer, GTextAlignmentCenter);
  set_footer("phone...");
  layer_add_child(root, text_layer_get_layer(s_footer));

  s_loading = layer_create(GRect(10, 54, 180, 84));
  layer_set_update_proc(s_loading, loading_update);
  layer_add_child(root, s_loading);
}

static void window_unload(Window *window) {
  int i;
  (void)window;
  drop_frame();
  bitmap_layer_destroy(s_frame_layer);
  layer_destroy(s_cross_layer);
  text_layer_destroy(s_footer);
  layer_destroy(s_loading);
  free_recv();
  for (i = 0; i < SLOT_COUNT; i++) {
    if (s_slot_png[i]) {
      free(s_slot_png[i]);
      s_slot_png[i] = NULL;
    }
  }
}

static void init(void) {
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload,
  });
  uint32_t inbox = app_message_inbox_size_maximum();
  if (inbox < 8200) {
    inbox = 8200;
  }
  app_message_register_inbox_received(inbox_received);
  app_message_open(inbox, 128);
  window_stack_push(s_window, true);
}

static void deinit(void) {
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}

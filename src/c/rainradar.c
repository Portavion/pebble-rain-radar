#include <pebble.h>
#include <stdio.h>

#define SLOT_COUNT 9
#define NOW_INDEX 4
#define RADAR_PX 200
#define FOOTER_PX 28

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
static BitmapLayer *s_bitmap_layer;
static Layer *s_cross_layer;
static TextLayer *s_footer;
static GBitmap *s_bitmap;
static uint8_t *s_img_data;
static int s_img_size;
static uint32_t s_request_id;
static uint32_t s_recv_id;
static int s_cursor = NOW_INDEX;
static ViewerTag s_view = VIEW_STARTING;
static bool s_js_ready;
static char s_footer_buf[32];
static time_t s_frame_time;

static void request_slot(void) {
  if (!s_js_ready) {
    return;
  }
  s_request_id++;
  s_view = VIEW_AWAITING;
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_SlotWanted, s_cursor);
  dict_write_uint32(iter, MESSAGE_KEY_RequestId, s_request_id);
  dict_write_int32(iter, MESSAGE_KEY_Slot, s_cursor);
  app_message_outbox_send();
}

static void set_footer(const char *text) {
  text_layer_set_text(s_footer, text);
}

static void format_ready_footer(void) {
  struct tm *tm = localtime(&s_frame_time);
  int off = SLOT_OFFSETS[s_cursor];
  if (off > 0) {
    snprintf(s_footer_buf, sizeof(s_footer_buf), "%02d:%02d  +%dm", tm->tm_hour, tm->tm_min, off);
  } else if (off < 0) {
    snprintf(s_footer_buf, sizeof(s_footer_buf), "%02d:%02d  %dm", tm->tm_hour, tm->tm_min, off);
  } else {
    snprintf(s_footer_buf, sizeof(s_footer_buf), "%02d:%02d  now", tm->tm_hour, tm->tm_min);
  }
  set_footer(s_footer_buf);
}

static void free_recv(void) {
  if (s_img_data) {
    free(s_img_data);
    s_img_data = NULL;
  }
  s_img_size = 0;
}

static void swap_bitmap(GBitmap *next) {
  bitmap_layer_set_bitmap(s_bitmap_layer, next);
  if (s_bitmap) {
    gbitmap_destroy(s_bitmap);
  }
  s_bitmap = next;
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
  s_cursor = next;
  snprintf(s_footer_buf, sizeof(s_footer_buf), "... %d", SLOT_OFFSETS[s_cursor]);
  set_footer(s_footer_buf);
  request_slot();
}

static void up_click(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  step_cursor(-1);
}

static void down_click(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  step_cursor(1);
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  (void)recognizer;
  (void)context;
  if (s_cursor == NOW_INDEX && s_view == VIEW_AWAITING) {
    return;
  }
  s_cursor = NOW_INDEX;
  set_footer("... now");
  request_slot();
}

static void click_config(void *context) {
  window_single_repeating_click_subscribe(BUTTON_ID_UP, 180, up_click);
  window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 180, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
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
    if (code == 1) {
      s_view = VIEW_FAILED;
      set_footer("no GPS");
    } else if (code == 2) {
      s_view = VIEW_FAILED;
      set_footer("no radar");
    } else if (code == 3) {
      s_view = VIEW_GAP;
      snprintf(s_footer_buf, sizeof(s_footer_buf), "no data  %+dm", SLOT_OFFSETS[s_cursor]);
      set_footer(s_footer_buf);
    }
  }

  Tuple *req = dict_find(iter, MESSAGE_KEY_RequestId);
  uint32_t rid = req ? req->value->uint32 : 0;

  Tuple *len = dict_find(iter, MESSAGE_KEY_DataLength);
  if (len) {
    if (rid && rid != s_request_id) {
      return;
    }
    s_recv_id = rid;
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
    if (s_recv_id != s_request_id || !s_img_data) {
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
    if (s_recv_id != s_request_id || !s_img_data) {
      return;
    }
    Tuple *ft = dict_find(iter, MESSAGE_KEY_FrameTime);
    if (ft) {
      s_frame_time = (time_t)ft->value->uint32;
    }
    GBitmap *next = gbitmap_create_from_png_data(s_img_data, (size_t)s_img_size);
    free_recv();
    if (!next) {
      s_view = VIEW_FAILED;
      set_footer("bad image");
      return;
    }
    swap_bitmap(next);
    s_view = VIEW_READY;
    format_ready_footer();
  }
}

static void cross_update(Layer *layer, GContext *ctx) {
  (void)layer;
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_line(ctx, GPoint(96, 100), GPoint(104, 100));
  graphics_draw_line(ctx, GPoint(100, 96), GPoint(100, 104));
}

static void window_load(Window *window) {
  (void)window;
  Layer *root = window_get_root_layer(window);
  window_set_background_color(window, GColorBlack);

  s_bitmap_layer = bitmap_layer_create(GRect(0, 0, RADAR_PX, RADAR_PX));
  bitmap_layer_set_background_color(s_bitmap_layer, GColorBlack);
  bitmap_layer_set_compositing_mode(s_bitmap_layer, GCompOpSet);
  layer_add_child(root, bitmap_layer_get_layer(s_bitmap_layer));

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
}

static void window_unload(Window *window) {
  (void)window;
  bitmap_layer_set_bitmap(s_bitmap_layer, NULL);
  if (s_bitmap) {
    gbitmap_destroy(s_bitmap);
    s_bitmap = NULL;
  }
  bitmap_layer_destroy(s_bitmap_layer);
  layer_destroy(s_cross_layer);
  text_layer_destroy(s_footer);
  free_recv();
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

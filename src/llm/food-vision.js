function analyzeFoodImage(imagePath) {
  if (!process.env.FOOD_VISION_API_KEY && !process.env.FOOD_VISION_COMMAND) {
    return {
      ok: false,
      code: 'VISION_NOT_CONFIGURED',
      message: 'Food vision interface is not configured',
      imagePath
    };
  }
  return {
    ok: false,
    code: 'VISION_ADAPTER_PLACEHOLDER',
    message: 'Food vision adapter placeholder: configure provider implementation here',
    imagePath
  };
}

module.exports = { analyzeFoodImage };

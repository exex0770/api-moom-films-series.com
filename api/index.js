module.exports = (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "MOOM Films & Series API is working",
    endpoints: {
      movies: "/api/movies",
      series: "/api/series"
    }
  });
};

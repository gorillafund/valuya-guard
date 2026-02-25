class PremiumController < ApplicationController
  include ValuyaGuard::ControllerProtect

  before_action -> { require_valuya_mandate(resource: "http:route:GET:/premium", plan: "standard") }, only: [:show]

  def show
    render json: { ok: true, data: "premium" }
  end
end

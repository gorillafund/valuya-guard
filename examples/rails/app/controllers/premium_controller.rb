class PremiumController < ApplicationController
  include Valuya::Guard::Rails::ControllerHelper

  before_action -> { require_valuya_mandate(resource: "http:route:GET:/premium", plan: "standard") }

  def show
    render json: { ok: true }
  end
end
